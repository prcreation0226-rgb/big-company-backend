import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';
import { uploadImage } from '../utils/cloudinary';
import { hashPassword } from '../utils/auth';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emailQueue } from '../queues/email.queue';
import { TemplateService } from '../services/template.service';
import { validateBusinessEmailFormat } from '../utils/email-validator';
import { calculateWholesalePrice, calculateRetailPrice } from '../utils/pricingUtils';

// Get detailed dashboard stats.
export const getDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    // Fix dates math bug (avoid modifying now object in place)
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Retrieve latest Reset date
    const resetAlert = await prisma.systemAlert.findFirst({
      where: { apiName: 'GAS_REPORTING_PERIOD_RESET' },
      orderBy: { createdAt: 'desc' }
    });
    const lastGasResetDate = resetAlert ? new Date(resetAlert.errorMessage) : null;

    // 1. Customers
    const customerTotal = await prisma.consumerProfile.count();
    const customerLast24h = await prisma.consumerProfile.count({ where: { user: { createdAt: { gte: last24h } } } });
    const customerLast7d = await prisma.consumerProfile.count({ where: { user: { createdAt: { gte: last7d } } } });
    const customerLast30d = await prisma.consumerProfile.count({ where: { user: { createdAt: { gte: last30d } } } });

    // Retrieve latest Retailer Profit Invoice Reset date (for Orders and Revenue)
    const profitResetAlert = await prisma.systemAlert.findFirst({
      where: { apiName: 'RETAILER_PROFIT_INVOICE_RESET' },
      orderBy: { createdAt: 'desc' }
    });
    const lastProfitResetDate = profitResetAlert ? new Date(profitResetAlert.errorMessage) : null;

    // 2. Orders & Revenue (Combine B2C Sales and B2B Wholesaler Orders)
    const [sales, wholesaleOrders] = await Promise.all([
      prisma.sale.findMany({
        where: {
          ...(lastProfitResetDate ? { createdAt: { gte: lastProfitResetDate } } : {}),
          saleItems: { some: {} },
          NOT: {
            saleItems: {
              some: {
                product: { category: { in: ['Gas', 'gas', 'GAS'] } }
              }
            }
          }
        },
        include: { saleItems: true }
      }),
      prisma.order.findMany({
        where: {
          NOT: {
            orderItems: {
              some: {
                product: { category: { in: ['Gas', 'gas', 'GAS'] } }
              }
            }
          }
        },
        include: { wholesalerProfile: true }
      })
    ]);

    const orderTotal = sales.length + wholesaleOrders.length;
    const orderPending = sales.filter(s => s.status === 'pending').length + wholesaleOrders.filter(o => o.status === 'pending').length;
    const orderProcessing = sales.filter(s => s.status === 'processing').length + wholesaleOrders.filter(o => o.status === 'processing').length;
    const orderDelivered = sales.filter(s => s.status === 'completed' || s.status === 'delivered').length + wholesaleOrders.filter(o => o.status === 'delivered').length;
    const orderCancelled = sales.filter(s => s.status === 'cancelled').length + wholesaleOrders.filter(o => o.status === 'cancelled').length;

    let salesRevenue = 0;
    for (const sale of sales) {
      if (sale.status === 'completed' || sale.status === 'delivered') {
        salesRevenue += sale.saleItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
      }
    }

    let wholesaleRevenue = 0;
    for (const order of wholesaleOrders) {
      if (order.status === 'delivered') {
        const settlementDate = (order.wholesalerProfile as any)?.lastSettlementDate;
        if (!settlementDate || order.createdAt >= settlementDate) {
          wholesaleRevenue += order.totalAmount;
        }
      }
    }
    const totalRevenue = Math.round(salesRevenue + wholesaleRevenue);

    // Only count active/real orders (exclude cancelled) for today's orders
    const todayOrders = sales.filter(s => s.createdAt >= todayStart && s.status !== 'cancelled').length + wholesaleOrders.filter(o => o.createdAt >= todayStart && o.status !== 'cancelled').length;

    // 3. Transactions (using WalletTransaction)

    const txs = await prisma.walletTransaction.findMany({ where: { createdAt: { gte: last30d } } });
    const txTotal = await prisma.walletTransaction.count();
    const walletTopups = txs.filter(t => t.type === 'top_up').length;
    const gasPurchases = txs.filter(t => t.type === 'gas_payment' || t.type === 'gas_purchase').length;
    const nfcPayments = sales.filter(s => s.paymentMethod === 'nfc' && s.createdAt >= last30d).length;
    const totalVolume = Math.round(txs
      .filter(t => lastGasResetDate ? t.createdAt >= lastGasResetDate : true)
      .reduce((acc, t) => acc + Math.abs(t.amount), 0)
    );

    // 4. Loans (Include both customer loans and retailer credit loans)
    const loans = await prisma.loan.findMany();
    const retailerCredits = await prisma.retailerCredit.findMany();

    const loanTotal = loans.length + retailerCredits.length;
    const loanPending = loans.filter(l => l.status === 'pending').length;
    // Active loans = customer active loans + retailers with outstanding credit balance
    const loanActive = loans.filter(l => l.status === 'active' || l.status === 'approved').length + retailerCredits.filter(r => r.usedCredit > 0).length;
    const loanPaid = loans.filter(l => l.status === 'paid' || l.status === 'repaid').length + retailerCredits.filter(r => r.usedCredit === 0).length;
    const loanDefaulted = loans.filter(l => l.status === 'defaulted' || l.status === 'overdue').length;

    // Calculate actual outstanding balances (principal - repayments) + retailer outstanding credit balances
    const customerLoanRepayments = await prisma.walletTransaction.findMany({
      where: { type: 'loan_repayment_replenish' }
    });
    const customerLoanOutstanding = loans.reduce((acc, l) => {
      if (l.status === 'active' || l.status === 'approved' || l.status === 'defaulted' || l.status === 'overdue') {
        const repayments = customerLoanRepayments.filter(r => r.reference === l.id.toString()).reduce((sum, r) => sum + r.amount, 0);
        return acc + Math.max(0, l.amount - repayments);
      }
      return acc;
    }, 0);
    const retailerOutstanding = retailerCredits.reduce((acc, r) => acc + r.usedCredit, 0);
    const outstandingAmount = Math.round(customerLoanOutstanding + retailerOutstanding);

    // 5. Gas (using GasTopup or Sale with gas category)

    const gasTopups = await prisma.gasTopup.findMany({
      where: {
        status: { in: ['completed', 'success'] },
        ...(lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {})
      }
    });
    const gasTotalPurchases = gasTopups.length;
    const gasTotalAmount = Math.round(gasTopups.reduce((acc, g) => acc + g.amount, 0));
    const gasTotalUnits = gasTopups.reduce((acc, g) => acc + g.units, 0);

    // 6. NFC Cards
    const nfcTotal = await prisma.nfcCard.count();
    const nfcActive = await prisma.nfcCard.count({ where: { status: 'active' } });
    const nfcLinked = await prisma.nfcCard.count({ where: { consumerId: { not: null } } });

    // 7. Retailers & Wholesalers
    const retailerTotal = await prisma.retailerProfile.count();
    const retailerActive = await prisma.retailerProfile.count({ where: { user: { isActive: true } } });
    const retailerVerified = await prisma.retailerProfile.count({ where: { isVerified: true } });
    const wholesalerTotal = await prisma.wholesalerProfile.count();
    const wholesalerActive = await prisma.wholesalerProfile.count({ where: { user: { isActive: true } } });

    // 8. System-wide Wallets (Consumer dashboard & Retailer capital wallets)
    const consumerWalletSum = await prisma.wallet.aggregate({
      where: { type: 'dashboard_wallet' },
      _sum: { balance: true }
    });
    const retailerCapitalSum = await prisma.retailerProfile.aggregate({
      _sum: { walletBalance: true }
    });
    const totalWalletBalance = Math.round(
      (consumerWalletSum._sum.balance || 0) +
      (retailerCapitalSum._sum.walletBalance || 0)
    );

    // 9. System-wide Rewards (Sum of all historically distributed gas rewards)
    const gasRewardsSum = await prisma.gasReward.aggregate({ _sum: { units: true } });
    const totalRewardsPoints = Math.round(gasRewardsSum._sum.units || 0);

    // 10. System-wide Inventory (Stock & evaluated cost value)
    const allProducts = await prisma.product.findMany();
    const totalProductsCount = allProducts.length;
    const totalInventoryValue = Math.round(
      allProducts.reduce((sum, p) => {
        if (p.retailerId !== null) {
          return sum + (p.stock * (p.costPrice || 0));
        }
        if (p.wholesalerId !== null) {
          const cost = p.supplierCost !== null && p.supplierCost !== undefined && p.supplierCost > 0 ? p.supplierCost : (p.costPrice || 0);
          return sum + (p.stock * cost);
        }
        return sum;
      }, 0)
    );

    // Recent Activity - Merge Sales, New Customers, Loans, and Gas Topups
    const [recentSales, recentConsumers, recentLoans, recentGas] = await Promise.all([
      prisma.sale.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        where: { saleItems: { some: {} } },
        include: {
          consumerProfile: { select: { fullName: true } }
        }
      }),
      prisma.consumerProfile.findMany({
        take: 5,
        orderBy: { user: { createdAt: 'desc' } },
        include: { user: true }
      }),
      prisma.loan.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { consumerProfile: true }
      }),
      prisma.gasTopup.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { consumerProfile: { select: { fullName: true } } }
      })
    ]);

    const activities: any[] = [
      ...recentSales.map(s => ({
        id: `sale-${s.id}`,
        action: 'order_placed',
        entity_type: 'order',
        description: `Order of ${Math.round(s.totalAmount)} RWF by ${s.consumerProfile?.fullName || 'Customer'}`,
        created_at: s.createdAt
      })),
      ...recentConsumers.map(c => ({
        id: `cust-${c.id}`,
        action: 'new_customer',
        entity_type: 'customer',
        description: `New customer ${c.fullName || c.user.name} joined`,
        created_at: c.user.createdAt
      })),
      ...recentLoans.map(l => ({
        id: `loan-${l.id}`,
        action: l.status === 'approved' ? 'loan_approved' : 'loan_requested',
        entity_type: 'loan',
        description: `Loan of ${Math.round(l.amount)} RWF ${l.status}`,
        created_at: l.createdAt
      })),
      ...recentGas.map(g => ({
        id: `gas-${g.id}`,
        action: 'gas_recharge',
        entity_type: 'gas',
        description: `${Math.round(g.amount)} RWF recharge for ${g.consumerProfile?.fullName || 'Customer'}`,
        created_at: g.createdAt
      }))
    ];

    const recentActivity = activities
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);

    const dashboard = {
      customers: { total: customerTotal, last24h: customerLast24h, last7d: customerLast7d, last30d: customerLast30d },
      orders: {
        total: orderTotal,
        pending: orderPending,
        processing: orderProcessing,
        delivered: orderDelivered,
        cancelled: orderCancelled,
        totalRevenue,
        todayOrders
      },
      transactions: {
        total: txTotal,
        walletTopups,
        gasPurchases,
        nfcPayments,
        loanDisbursements: txs.filter(t => t.type === 'loan' || t.type === 'disbursement').length,
        totalVolume
      },
      loans: {
        total: loanTotal,
        pending: loanPending,
        active: loanActive,
        paid: loanPaid,
        defaulted: loanDefaulted,
        outstandingAmount
      },
      gas: { totalPurchases: gasTotalPurchases, totalAmount: gasTotalAmount, totalUnits: gasTotalUnits },
      nfcCards: { total: nfcTotal, active: nfcActive, linked: nfcLinked },
      retailers: { total: retailerTotal, active: retailerActive, verified: retailerVerified },
      wholesalers: { total: wholesalerTotal, active: wholesalerActive },
      wallets: { totalBalance: totalWalletBalance },
      rewards: { totalPoints: totalRewardsPoints },
      inventory: { totalProducts: totalProductsCount, totalValue: totalInventoryValue },
      recentActivity
    };

    res.json({
      success: true,
      dashboard
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getReports = async (req: AuthRequest, res: Response) => {
  try {
    const { dateRange } = req.query;
    const now = new Date();
    let startDate = new Date(0); // All time default

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    if (dateRange === 'today') {
      startDate = todayStart;
    } else if (dateRange === '7days') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateRange === '30days') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (dateRange === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    // 1. Stats based on date range
    const [sales, wholesaleOrders, gasTopups] = await Promise.all([
      prisma.sale.findMany({ 
        where: { 
          createdAt: { gte: startDate },
          saleItems: { some: {} }
        } 
      }),
      prisma.order.findMany({ where: { createdAt: { gte: startDate } } }),
      prisma.gasTopup.findMany({ where: { createdAt: { gte: startDate }, status: { in: ['completed', 'success'] } } })
    ]);

    const salesRevenue = sales.filter(s => s.status === 'completed' || s.status === 'delivered').reduce((acc, s) => acc + s.totalAmount, 0);
    const wholesaleRevenue = wholesaleOrders.filter(o => o.status === 'delivered').reduce((acc, o) => acc + o.totalAmount, 0);
    const totalRevenue = Math.round(salesRevenue + wholesaleRevenue);

    const orderTotal = sales.filter(s => s.status !== 'cancelled').length + wholesaleOrders.filter(o => o.status !== 'cancelled').length;
    const gasDistributed = gasTopups.reduce((acc, g) => acc + g.units, 0);

    // 2. Global counts
    const [retailerTotal, wholesalerTotal, productTotal, customerTotal, loans, retailerCredits] = await Promise.all([
      prisma.retailerProfile.count(),
      prisma.wholesalerProfile.count(),
      prisma.product.count(),
      prisma.consumerProfile.count(),
      prisma.loan.findMany(),
      prisma.retailerCredit.findMany()
    ]);

    const activeLoans = loans.filter(l => l.status === 'active' || l.status === 'approved').length + retailerCredits.filter(r => r.usedCredit > 0).length;
    const pendingLoans = loans.filter(l => l.status === 'pending').length;

    const customerLoanRepayments = await prisma.walletTransaction.findMany({
      where: { type: 'loan_repayment_replenish' }
    });
    const customerLoanOutstanding = loans.reduce((acc, l) => {
      if (l.status === 'active' || l.status === 'approved' || l.status === 'defaulted' || l.status === 'overdue') {
        const repayments = customerLoanRepayments.filter(r => r.reference === l.id.toString()).reduce((sum, r) => sum + r.amount, 0);
        return acc + Math.max(0, l.amount - repayments);
      }
      return acc;
    }, 0);
    const retailerOutstanding = retailerCredits.reduce((acc, r) => acc + r.usedCredit, 0);
    const totalLoanAmount = Math.round(customerLoanOutstanding + retailerOutstanding);

    // 3. Dynamic Growth rate calculation
    const periodDuration = now.getTime() - startDate.getTime();
    const prevPeriodStart = new Date(startDate.getTime() - periodDuration);
    const [prevSales, prevWholesale] = await Promise.all([
      prisma.sale.findMany({
        where: {
          createdAt: {
            gte: prevPeriodStart,
            lt: startDate
          },
          saleItems: { some: {} }
        }
      }),
      prisma.order.findMany({
        where: {
          createdAt: {
            gte: prevPeriodStart,
            lt: startDate
          }
        }
      })
    ]);
    const prevSalesRevenue = prevSales.filter(s => s.status === 'completed' || s.status === 'delivered').reduce((acc, s) => acc + s.totalAmount, 0);
    const prevWholesaleRevenue = prevWholesale.filter(o => o.status === 'delivered').reduce((acc, o) => acc + o.totalAmount, 0);
    const prevRevenue = Math.round(prevSalesRevenue + prevWholesaleRevenue);

    const growthRate = prevRevenue > 0
      ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 1000) / 10
      : 12.5; // fallback to 12.5 if no previous data

    // 4. Calculate Daily Sales Trend (grouped by formatted date)
    const dailySalesMap: Record<string, number> = {};
    sales.filter(s => s.status === 'completed' || s.status === 'delivered').forEach(s => {
      const dateStr = s.createdAt.toISOString().split('T')[0];
      dailySalesMap[dateStr] = (dailySalesMap[dateStr] || 0) + s.totalAmount;
    });
    wholesaleOrders.filter(o => o.status === 'delivered').forEach(o => {
      const dateStr = o.createdAt.toISOString().split('T')[0];
      dailySalesMap[dateStr] = (dailySalesMap[dateStr] || 0) + o.totalAmount;
    });
    const dailySales = Object.entries(dailySalesMap).map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date));

    // 5. Calculate Top Products (Top 5 based on sale items quantity)
    const saleItems = await prisma.saleItem.findMany({
      where: { sale: { status: { in: ['completed', 'delivered'] } } },
      include: { product: true }
    });
    const productSalesMap: Record<string, { name: string, quantity: number, revenue: number }> = {};
    saleItems.forEach(item => {
      if (item.product) {
        const prodId = item.productId.toString();
        if (!productSalesMap[prodId]) {
          productSalesMap[prodId] = { name: item.product.name, quantity: 0, revenue: 0 };
        }
        productSalesMap[prodId].quantity += item.quantity;
        productSalesMap[prodId].revenue += item.quantity * item.price;
      }
    });
    const topProducts = Object.values(productSalesMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // 6. Calculate Top Retailers (Top 5 based on sales revenue)
    const retailers = await prisma.retailerProfile.findMany({
      include: {
        sales: {
          where: { 
            status: { in: ['completed', 'delivered'] },
            saleItems: { some: {} }
          }
        }
      }
    });
    const topRetailers = retailers.map(r => {
      const totalRevenue = r.sales.reduce((sum, s) => sum + s.totalAmount, 0);
      return {
        id: r.id,
        shopName: r.shopName,
        revenue: totalRevenue,
        salesCount: r.sales.length
      };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    res.json({
      success: true,
      summary: {
        totalRevenue,
        orderTotal,
        retailerTotal,
        wholesalerTotal,
        gasDistributed,
        growthRate,
        dailySales,
        topProducts,
        topRetailers,
        businessOverview: {
          totalProducts: productTotal,
          totalCustomers: customerTotal,
          totalSalesVolume: orderTotal,
          avgOrderValue: orderTotal > 0 ? Math.round(totalRevenue / orderTotal) : 0
        },
        loanOverview: {
          activeLoans,
          totalLoanAmount,
          pendingApprovals: pendingLoans
        },
        targets: {
          orders: 5000,
          retailers: 200,
          gas: 2000
        }
      }
    });
  } catch (error: any) {
    console.error('Get Reports Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get customers
export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const customers = await prisma.consumerProfile.findMany({
      include: {
        user: true,
        wallets: true,
        gasRewards: true,
        sales: {
          include: {
            saleItems: true
          }
        },
        gasTopups: {
          select: {
            units: true
          }
        },
        gasMeters: {
          where: { status: { not: 'removed' } }
        }
      }
    });

    const retailerProfiles = await prisma.retailerProfile.findMany();
    const retailerMap = new Map(retailerProfiles.map(rp => [rp.id, rp]));

    const formattedCustomers = customers.map(customer => {
      const activeSales = customer.sales.filter(sale => {
        // Exclude gas top-up purchases (which have no saleItems)
        if (!sale.saleItems || sale.saleItems.length === 0) {
          return false;
        }

        // Exclude sales before the retailer's lastSettlementDate
        const retailer = retailerMap.get(sale.retailerId);
        const settlementDate = retailer?.lastSettlementDate;
        if (settlementDate) {
          return new Date(sale.createdAt) >= new Date(settlementDate);
        }
        return true;
      });

      const orderCount = activeSales.length;
      const totalSpent = activeSales.reduce((sum, sale) => sum + sale.totalAmount, 0);

      // Calculate gas rewards balance dynamically
      const totalGasRewards = customer.gasRewards.reduce((sum, r) => sum + r.units, 0);
      const gasBalance = totalGasRewards.toFixed(3) + " M³";

      // Calculate active cash/dashboard wallet balance dynamically
      const cashWallet = customer.wallets.find(w => w.type === 'dashboard_wallet' || w.type === 'main');
      const walletBalance = cashWallet ? cashWallet.balance : 0;

      // Calculate gas rewards balance dynamically (convert to points where 1 m3 = 100 points for frontend rendering)
      const rewardsPoints = totalGasRewards * 100;

      return {
        ...customer,
        walletBalance,
        rewardsPoints,
        orderCount,
        totalSpent,
        gasBalance
      };
    });

    res.json({ success: true, customers: formattedCustomers });
  } catch (error: any) {
    console.error('Get Customers Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const customer = await prisma.consumerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        wallets: true,
        nfcCards: true,
        gasMeters: {
          where: { status: { not: 'removed' } }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, customer });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create customer (Admin only)
export const createCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { email, phone, password, pin, first_name, last_name, full_name } = req.body;

    console.log('📝 Creating customer with data:', { first_name, last_name, full_name, phone, email });

    // Validate required fields
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (!password && !pin) {
      return res.status(400).json({ error: 'Either password or PIN is required' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phone },
          ...(email ? [{ email }] : [])
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this phone or email already exists' });
    }

    // Hash password/pin
    const hashedPassword = password ? await hashPassword(password) : undefined;
    const hashedPin = pin ? await hashPassword(pin) : undefined;

    // Create user and profile in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Construct full name properly
      const fullName = full_name ||
        (first_name ? `${first_name}${last_name ? ' ' + last_name : ''}`.trim() : null);

      const userName = fullName || phone;

      const user = await tx.user.create({
        data: {
          email,
          phone,
          password: hashedPassword,
          pin: hashedPin,
          role: 'consumer',
          name: userName,
          isActive: true,
          isFirstLogin: false
        }
      });

      const consumerProfile = await tx.consumerProfile.create({
        data: {
          userId: user.id,
          fullName: fullName
        }
      });

      return { user, consumerProfile };
    });

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      customer: {
        ...result.consumerProfile,
        user: result.user
      }
    });
  } catch (error: any) {
    console.error('Create Customer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getRetailers = async (req: AuthRequest, res: Response) => {
  try {
    const retailers = await prisma.retailerProfile.findMany({
      include: {
        user: true,
        sales: {
          select: {
            totalAmount: true
          }
        },
        credit: true
      }
    });

    const formattedRetailers = retailers.map(retailer => {
      const orders = retailer.sales.length;
      const revenue = retailer.sales.reduce((sum, s) => sum + s.totalAmount, 0);
      const creditLimit = retailer.credit ? retailer.credit.creditLimit : retailer.creditLimit;

      return {
        ...retailer,
        orders,
        revenue,
        creditLimit
      };
    });

    res.json({ success: true, retailers: formattedRetailers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create retailer
export const createRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, business_name, phone, address, credit_limit } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: `The email ${email} is already registered. Please use a unique business email.` });
    }

    if (!validateBusinessEmailFormat(email, 'retailer')) {
      return res.status(400).json({ error: 'Retailer email must follow the format: name.retailer@big.co.rw' });
    }

    const actualPassword = password || crypto.randomBytes(4).toString('hex');
    const hashedPassword = await hashPassword(actualPassword);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        tempPassword: password ? null : actualPassword,
        isFirstLogin: password ? false : true,
        role: 'retailer',
        name: business_name,
        isActive: true
      }
    });

    const retailer = await prisma.retailerProfile.create({
      data: {
        userId: user.id,
        shopName: business_name,
        address,
        creditLimit: parseFloat(credit_limit || '0'),
        walletBalance: 0
      }
    });

    // Queue Onboarding Email (RET-EMAIL-001)
    await emailQueue.add('onboarding-email', {
      to: email,
      templateType: 'retailer-registration', // Mapped to RET-EMAIL-001
      data: {
        retail_name: business_name,
        retail_id: retailer.id.toString(),
        phone: phone,
        email: email,
        created_date: new Date().toLocaleDateString(),
        login_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/retailer/login?email=${email}&tempPass=${actualPassword}`
      },
      relatedEntity: { type: 'USER', id: user.id.toString() }
    });

    res.json({ success: true, message: 'Retailer created successfully' });
  } catch (error: any) {
    console.error('Create Retailer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get wholesalers
export const getWholesalers = async (req: AuthRequest, res: Response) => {
  try {
    const wholesalers = await prisma.wholesalerProfile.findMany({
      include: {
        user: true,
        receivedOrders: {
          select: {
            totalAmount: true,
            status: true
          }
        }
      }
    });

    const formattedWholesalers = wholesalers.map(wholesaler => {
      const deliveredOrders = wholesaler.receivedOrders.filter(o => o.status === 'delivered');
      const orders = deliveredOrders.length;
      const revenue = deliveredOrders.reduce((sum, o) => sum + o.totalAmount, 0);

      return {
        ...wholesaler,
        orders,
        revenue
      };
    });

    res.json({ success: true, wholesalers: formattedWholesalers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create wholesaler
export const createWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, company_name, phone, address } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: `The email ${email} is already registered. Please use a unique business email.` });
    }

    if (!validateBusinessEmailFormat(email, 'wholesaler')) {
      return res.status(400).json({ error: 'Wholesaler email must follow the format: name.wholesaler@big.co.rw' });
    }

    const actualPassword = password || crypto.randomBytes(4).toString('hex');
    const hashedPassword = await hashPassword(actualPassword);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        tempPassword: password ? null : actualPassword,
        isFirstLogin: password ? false : true,
        role: 'wholesaler',
        name: company_name,
        isActive: true
      }
    });

    // Queue Onboarding Email (WHO-EMAIL-001)
    await emailQueue.add('onboarding-email', {
      to: email,
      templateType: 'wholesaler-registration', // Mapped to WHO-EMAIL-001
      data: {
        wholesaler_name: company_name,
        wholesaler_id: user.id.toString(), // Using user.id as fallback for ID
        phone: phone,
        email: email,
        created_date: new Date().toLocaleDateString(),
        login_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/wholesaler/login?email=${email}&tempPass=${actualPassword}`
      },
      relatedEntity: { type: 'USER', id: user.id.toString() }
    });

    await prisma.wholesalerProfile.create({
      data: {
        userId: user.id,
        companyName: company_name,
        address
      }
    });

    res.json({ success: true, message: 'Wholesaler created successfully' });
  } catch (error: any) {
    console.error('Create Wholesaler Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get loans
export const getLoans = async (req: AuthRequest, res: Response) => {
  try {
    // Fetch live interest rates from SystemConfig
    const config = await prisma.systemConfig.findFirst();
    const rates = {
      customerInterestRate: config?.customerLoanInterest ?? 10,
      retailerInterestRate: config?.retailerLoanInterest ?? 0,
      wholesalerInterestRate: config?.wholesalerLoanInterest ?? 8
    };

    // 1. Fetch Consumer Loans
    const consumerLoansRaw = await prisma.loan.findMany({
      include: {
        consumerProfile: {
          include: {
            user: true,
            wallets: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const consumerLoans = await Promise.all(consumerLoansRaw.map(async (loan) => {
      const repaymentTransactions = await prisma.walletTransaction.findMany({
        where: {
          reference: loan.id.toString(),
          OR: [
            { type: 'loan_repayment_replenish' },
            { type: 'debit', description: { contains: 'Loan Repayment' } }
          ]
        }
      });

      const amountPaid = repaymentTransactions
        .filter(txn => txn.type === 'loan_repayment_replenish')
        .reduce((sum, txn) => sum + txn.amount, 0);

      const rate = Number(rates.customerInterestRate) || 10;
      const interestAmount = Math.round(loan.amount * (rate / 100));
      const totalRepayable = loan.amount + interestAmount;
      const amountRemaining = Math.max(0, totalRepayable - amountPaid);

      let loanStatus = loan.status;
      if (amountPaid >= totalRepayable && loan.status !== 'repaid' && loan.status !== 'rejected') {
        await prisma.loan.update({
          where: { id: loan.id },
          data: { status: 'repaid' }
        });
        loanStatus = 'repaid';
      }

      return {
        id: loan.id,
        user_id: loan.consumerProfile?.userId?.toString() || '',
        user_name: loan.consumerProfile?.fullName || loan.consumerProfile?.user?.name || 'Customer',
        user_type: 'consumer',
        amount: loan.amount,
        interest_rate: rate,
        interest_amount: interestAmount,
        duration_months: 1,
        monthly_payment: totalRepayable,
        total_repayable: totalRepayable,
        amount_paid: amountPaid,
        amount_remaining: amountRemaining,
        status: loanStatus,
        lender: 'Big Innovation Group Ltd',
        created_at: loan.createdAt.toISOString(),
        due_date: loan.dueDate?.toISOString()
      };
    }));

    // 2. Fetch Retailer Stock Loans (CreditRequests)
    const creditRequestsRaw = await prisma.creditRequest.findMany({
      include: {
        retailerProfile: {
          include: {
            user: true,
            linkedWholesaler: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const retailerLoans = creditRequestsRaw.map((cr) => {
      const rate = Number(rates.retailerInterestRate) || 0;
      const interestAmount = Math.round(cr.amount * (rate / 100));
      const totalRepayable = cr.amount + interestAmount;

      let st = cr.status;
      if (st === 'pending') st = 'pending';
      else if (st === 'approved') st = 'active';
      else if (st === 'rejected') st = 'rejected';
      else st = 'completed';

      return {
        id: 10000 + cr.id,
        user_id: cr.retailerProfile?.userId?.toString() || '',
        user_name: cr.retailerProfile?.shopName || 'Retailer Shop',
        user_type: 'retailer',
        amount: cr.amount,
        interest_rate: rate,
        interest_amount: interestAmount,
        duration_months: 1,
        monthly_payment: totalRepayable,
        total_repayable: totalRepayable,
        amount_paid: st === 'completed' ? totalRepayable : 0,
        amount_remaining: (st === 'completed' || st === 'rejected') ? 0 : totalRepayable,
        status: st,
        lender: cr.retailerProfile?.linkedWholesaler?.companyName || 'Associated Wholesaler Shop',
        created_at: cr.createdAt.toISOString(),
        due_date: new Date(cr.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
    });

    // 3. Dynamic Wholesaler Loans based on Supplier Payments (Outstanding bills acting as wholesaler liabilities)
    const supplierPayments = await prisma.supplierPayment.findMany({
      include: {
        supplier: true,
        wholesalerProfile: {
          include: { user: true }
        }
      }
    });

    const wholesalerLoans = supplierPayments.map((sp) => {
      const rate = Number(rates.wholesalerInterestRate) || 8;
      const interestAmount = Math.round(sp.amount * (rate / 100));
      const totalRepayable = sp.amount + interestAmount;
      return {
        id: 20000 + sp.id,
        user_id: sp.wholesalerProfile?.userId?.toString() || sp.wholesalerId.toString(),
        user_name: sp.wholesalerProfile?.companyName || 'Wholesaler Company',
        user_type: 'wholesaler',
        amount: sp.amount,
        interest_rate: rate,
        interest_amount: interestAmount,
        duration_months: 1,
        monthly_payment: totalRepayable,
        total_repayable: totalRepayable,
        amount_paid: sp.status === 'completed' ? totalRepayable : 0,
        amount_remaining: sp.status === 'completed' ? 0 : totalRepayable,
        status: sp.status === 'completed' ? 'completed' : 'active',
        lender: sp.supplier.name,
        created_at: sp.paymentDate.toISOString(),
        due_date: new Date(sp.paymentDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
    });

    const allLoans = [...consumerLoans, ...retailerLoans, ...wholesalerLoans];
    res.json({ success: true, loans: allLoans });
  } catch (error: any) {
    console.error('Get Admin Loans Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get NFC cards
export const getNFCCards = async (req: AuthRequest, res: Response) => {
  try {
    const cards = await prisma.nfcCard.findMany({
      include: {
        consumerProfile: {
          include: {
            user: true,
            wallets: true
          }
        },
        retailerProfile: { include: { user: true } }
      }
    });

    const formattedCards = await Promise.all(cards.map(async (card) => {
      const dashboardWallet = card.consumerProfile?.wallets.find(w => w.type === 'dashboard_wallet');
      const creditWallet = card.consumerProfile?.wallets.find(w => w.type === 'credit_wallet');

      // Calculate actual transaction count from both Retail sales and Gas recharges
      let transactionCount = 0;
      if (card.consumerId) {
        const [salesCount, gasCount] = await Promise.all([
          prisma.sale.count({ where: { consumerId: card.consumerId, paymentMethod: 'nfc_card' } }),
          prisma.gasRechargeTransaction.count({ where: { customerId: card.consumerId, paymentMethod: 'nfc_card' } })
        ]);
        transactionCount = salesCount + gasCount;
      }

      // Fallback cascading logic to find accurate user identification
      const candidateName = card.consumerProfile?.fullName ||
        card.consumerProfile?.user?.name ||
        card.retailerProfile?.shopName ||
        card.retailerProfile?.user?.name ||
        card.cardholderName ||
        'Unassigned';

      return {
        id: card.id,
        uid: card.uid,
        status: card.status === 'available' ? 'active' : card.status,
        balance: card.balance,
        dashboardBalance: dashboardWallet?.balance || 0,
        creditBalance: creditWallet?.balance || 0,
        user_name: candidateName,
        transaction_count: transactionCount,
        user_type: card.consumerProfile ? 'consumer' : (card.retailerProfile ? 'retailer' : undefined),
        created_at: card.createdAt,
        last_used: card.updatedAt,
        consumerProfile: card.consumerProfile
      };
    }));

    res.json({ success: true, cards: formattedCards });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// CATEGORY MANAGEMENT
// ==========================================

export const getCategories = async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' }
    });

    // Manually count products for each category to be Railway-safe without schema migrations
    const categoriesWithCount = await Promise.all(
      categories.map(async (cat) => {
        const productCount = await prisma.product.count({
          where: {
            category: cat.name,
            status: 'active'
          }
        });
        return {
          ...cat,
          productCount
        };
      })
    );

    res.json({ success: true, categories: categoriesWithCount });
  } catch (error: any) {
    console.error('Get Categories Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, code } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    // Check if code exists
    if (code) {
      const existing = await prisma.category.findUnique({ where: { code } });
      if (existing) return res.status(400).json({ success: false, message: 'Category code already exists' });
    }

    const category = await prisma.category.create({
      data: {
        name,
        code: code || name.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
        description,
        isActive: true
      }
    });
    res.status(201).json({ success: true, category, message: 'Category created successfully' });
  } catch (error: any) {
    console.error('Create Category Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, description, isActive } = req.body;

    // Fetch old category to see if name changed
    const oldCategory = await prisma.category.findUnique({
      where: { id: Number(id) }
    });

    const category = await prisma.category.update({
      where: { id: Number(id) },
      data: { name, code, description, isActive }
    });

    // Rename category on all products if name changed
    if (oldCategory && oldCategory.name !== name) {
      console.log(`Renaming product categories from "${oldCategory.name}" to "${name}"`);
      await prisma.product.updateMany({
        where: { category: oldCategory.name },
        data: { category: name }
      });
    }

    res.json({ success: true, category, message: 'Category updated successfully' });
  } catch (error: any) {
    console.error('Update Category Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Find category name first
    const categoryObj = await prisma.category.findUnique({
      where: { id: Number(id) }
    });

    if (categoryObj) {
      // Set category of all products with this name to 'Uncategorized'
      await prisma.product.updateMany({
        where: { category: categoryObj.name },
        data: { category: 'Uncategorized' }
      });
    }

    await prisma.category.delete({ where: { id: Number(id) } });
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error: any) {
    console.error('Delete Category Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// RETAILER MANAGEMENT (Extra CRUD)
// ==========================================

export const updateRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // RetailerProfile ID
    const { business_name, email, phone, address, credit_limit, status } = req.body;

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (!retailer) return res.status(404).json({ error: 'Retailer not found' });

    // Check for duplicate phone on OTHER users
    if (phone) {
      const existingUser = await prisma.user.findFirst({
        where: {
          phone,
          id: { not: retailer.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Phone ${phone} is already in use by another account` });
      }
    }

    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: retailer.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Email ${email} is already in use by another account` });
      }
    }

    await prisma.retailerProfile.update({
      where: { id: Number(id) },
      data: {
        shopName: business_name,
        address,
        creditLimit: credit_limit ? Number(credit_limit) : undefined,
      }
    });

    if (phone || business_name || status) {
      await prisma.user.update({
        where: { id: retailer.userId },
        data: {
          phone,
          name: business_name,
          isActive: status === 'active'
        }
      });
    }

    res.json({ success: true, message: 'Retailer updated' });
  } catch (error: any) {
    console.error('Update Retailer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (retailer) {
      // Delete profile first to satisfy FK
      await prisma.retailerProfile.delete({ where: { id: Number(id) } });
      // Then delete user
      await prisma.user.delete({ where: { id: retailer.userId } });
    }
    res.json({ success: true, message: 'Retailer deleted' });
  } catch (error: any) {
    console.error('Delete Retailer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const verifyRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if retailer exists
    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (!retailer) return res.status(404).json({ success: false, message: 'Retailer not found' });

    // Update isVerified status
    await prisma.retailerProfile.update({
      where: { id: Number(id) },
      data: { isVerified: true }
    });

    res.json({ success: true, message: 'Retailer verified successfully' });
  } catch (error: any) {
    console.error('Verify Retailer Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if wholesaler exists
    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (!wholesaler) return res.status(404).json({ success: false, message: 'Wholesaler not found' });

    // Update isVerified status
    await prisma.wholesalerProfile.update({
      where: { id: Number(id) },
      data: { isVerified: true }
    });

    res.json({ success: true, message: 'Wholesaler verified successfully' });
  } catch (error: any) {
    console.error('Verify Wholesaler Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// WHOLESALER MANAGEMENT (Extra CRUD)
// ==========================================

export const updateWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_name, email, phone, address, status } = req.body;

    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (!wholesaler) return res.status(404).json({ error: 'Wholesaler not found' });

    // Check for duplicate phone on OTHER users
    if (phone) {
      const existingUser = await prisma.user.findFirst({
        where: {
          phone,
          id: { not: wholesaler.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Phone ${phone} is already in use by another account` });
      }
    }

    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: wholesaler.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Email ${email} is already in use by another account` });
      }
    }

    await prisma.wholesalerProfile.update({
      where: { id: Number(id) },
      data: {
        companyName: company_name,
        address
      }
    });

    if (phone || company_name || status) {
      await prisma.user.update({
        where: { id: wholesaler.userId },
        data: {
          phone,
          name: company_name,
          isActive: status === 'active'
        }
      });
    }

    res.json({ success: true, message: 'Wholesaler updated' });
  } catch (error: any) {
    console.error('Update Wholesaler Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (wholesaler) {
      // Delete profile first to satisfy FK
      await prisma.wholesalerProfile.delete({ where: { id: Number(id) } });
      // Then delete user
      await prisma.user.delete({ where: { id: wholesaler.userId } });
    }
    res.json({ success: true, message: 'Wholesaler deleted' });
  } catch (error: any) {
    console.error('Delete Wholesaler Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const updateRetailerStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;
    console.log(`Updating Retailer Status - ID: ${id}, isActive: ${isActive}, status: ${status}`);

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (!retailer) {
      console.log(`Retailer NOT FOUND for ID: ${id}`);
      return res.status(404).json({ error: 'Retailer not found' });
    }

    // Determine new status
    let newStatus = false;
    if (typeof isActive === 'boolean') {
      newStatus = isActive;
    } else if (status === 'active') {
      newStatus = true;
    } else if (status === 'inactive') {
      newStatus = false;
    }

    console.log(`Resolved status for User ${retailer.userId}: ${newStatus}`);

    // Update User status
    const updatedUser = await prisma.user.update({
      where: { id: retailer.userId },
      data: {
        isActive: newStatus
      }
    });

    // Notify User of account action (PRD 2.A.iv)
    if (updatedUser.email) {
      await emailQueue.add('account-action-alert', {
        to: updatedUser.email,
        templateType: 'account-action-alert', // Mapped to SYS-EMAIL-001
        data: {
          action: newStatus ? 'Reactivated' : 'Suspended',
          status: newStatus ? 'activated' : 'suspended',
          date: new Date().toLocaleDateString(),
          reason: newStatus
            ? 'Your account has been reactivated by the system administrator.'
            : 'Your account has been suspended by the system administrator.'
        },
        relatedEntity: { type: 'USER', id: updatedUser.id.toString() }
      });
    }

    res.json({ success: true, message: `Retailer status updated to ${newStatus ? 'active' : 'inactive'}` });
  } catch (error: any) {
    console.error('Update Retailer Status Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateWholesalerStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;
    console.log(`Updating Wholesaler Status - ID: ${id}, isActive: ${isActive}, status: ${status}`);

    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (!wholesaler) {
      console.log(`Wholesaler NOT FOUND for ID: ${id}`);
      return res.status(404).json({ error: 'Wholesaler not found' });
    }

    // Determine new status
    let newStatus = false;
    if (typeof isActive === 'boolean') {
      newStatus = isActive;
    } else if (status === 'active') {
      newStatus = true;
    } else if (status === 'inactive') {
      newStatus = false;
    }

    console.log(`Resolved status for User ${wholesaler.userId}: ${newStatus}`);

    // Update User status
    const updatedUser = await prisma.user.update({
      where: { id: wholesaler.userId },
      data: {
        isActive: newStatus
      }
    });

    // Notify User of account action (PRD 2.A.iv)
    if (updatedUser.email) {
      await emailQueue.add('account-action-alert', {
        to: updatedUser.email,
        templateType: 'account-action-alert', // Mapped to SYS-EMAIL-001
        data: {
          action: newStatus ? 'Reactivated' : 'Suspended',
          status: newStatus ? 'activated' : 'suspended',
          date: new Date().toLocaleDateString(),
          reason: newStatus
            ? 'Your account has been reactivated by the system administrator.'
            : 'Your account has been suspended by the system administrator.'
        },
        relatedEntity: { type: 'USER', id: updatedUser.id.toString() }
      });
    }

    res.json({ success: true, message: `Wholesaler status updated to ${newStatus ? 'active' : 'inactive'}` });
  } catch (error: any) {
    console.error('Update Wholesaler Status Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// CUSTOMER MANAGEMENT (Extra CRUD)
// ==========================================

// Note: createCustomer is now defined earlier in the file (after getCustomer)

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // ConsumerProfile ID
    const { firstName, lastName, email, phone, status } = req.body;

    const profile = await prisma.consumerProfile.findUnique({ where: { id: Number(id) } });
    if (!profile) return res.status(404).json({ error: 'Customer not found' });

    // Check if email/phone is taken by ANOTHER user
    if (email || phone) {
      const orConditions = [];
      if (email) orConditions.push({ email });
      if (phone) orConditions.push({ phone });

      if (orConditions.length > 0) {
        const existingUser = await prisma.user.findFirst({
          where: {
            AND: [
              { id: { not: profile.userId } }, // Exclude current user
              { OR: orConditions }
            ]
          }
        });

        if (existingUser) {
          return res.status(400).json({ error: 'Email or phone already in use by another user' });
        }
      }
    }

    await prisma.user.update({
      where: { id: profile.userId },
      data: {
        name: `${firstName} ${lastName}`,
        email,
        phone,
        isActive: status === 'active'
      }
    });

    await prisma.consumerProfile.update({
      where: { id: Number(id) },
      data: { fullName: `${firstName} ${lastName}` }
    });

    res.json({ success: true, message: 'Customer updated' });
  } catch (error: any) {
    console.error('Update Customer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const updateCustomerStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, isActive } = req.body;

    console.log(`[AdminAPI] updateCustomerStatus - ID: ${id}, isActive: ${isActive}, status: ${status}`);

    // Determine new status
    let newStatus = false;
    if (typeof isActive === 'boolean') {
      newStatus = isActive;
    } else if (status === 'active') {
      newStatus = true;
    } else if (status === 'inactive') {
      newStatus = false;
    }

    const targetId = Number(id);

    // Check if it's a profile ID
    let profile = await prisma.consumerProfile.findUnique({ where: { id: targetId } });

    let updatedUser: any;
    if (profile) {
      console.log(`[AdminAPI] Found ConsumerProfile by ID ${targetId}, updating user ${profile.userId}`);
      updatedUser = await prisma.user.update({
        where: { id: profile.userId },
        data: { isActive: newStatus }
      });
    } else {
      // Check if it's a user ID directly (legacy support)
      const user = await prisma.user.findUnique({ where: { id: targetId } });
      if (!user) {
        console.error(`[AdminAPI] Customer not found for ID ${targetId}`);
        return res.status(404).json({ error: 'Customer not found' });
      }

      console.log(`[AdminAPI] Found User by ID ${targetId}, updating directly`);
      updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { isActive: newStatus }
      });
    }

    // Trigger Account Activation/Deactivation SMS (CUS-SMS-012)
    if (updatedUser && updatedUser.phone) {
      try {
        const { emailQueue } = await import('../queues/email.queue');
        await emailQueue.add('customer-account-status', {
          to: updatedUser.phone,
          templateType: 'customer-account-status', // Mapped to CUS-SMS-012
          data: {
            customer_name: updatedUser.name || 'Valued Customer',
            status: newStatus ? 'activated' : 'deactivated',
            date: new Date().toLocaleDateString(),
            reason: newStatus ? 'Account activated or approved' : 'Account deactivated or suspended'
          },
          relatedEntity: { type: 'USER', id: updatedUser.id.toString() }
        });
      } catch (err: any) {
        console.error('[AdminAPI] Failed to trigger customer-account-status notification:', err.message);
      }
    }

    if (updatedUser && updatedUser.email) {
      try {
        const { emailQueue } = await import('../queues/email.queue');
        await emailQueue.add('customer-account-status-email', {
          to: updatedUser.email,
          templateType: 'customer-account-status-email', // Mapped to CUS-EMAIL-010
          data: {
            customer_name: updatedUser.name || 'Valued Customer',
            status: newStatus ? 'activated' : 'deactivated',
            date: new Date().toLocaleDateString(),
            reason: newStatus ? 'Account activated or approved' : 'Account deactivated or suspended'
          },
          relatedEntity: { type: 'USER', id: updatedUser.id.toString() }
        });
      } catch (err: any) {
        console.error('[AdminAPI] Failed to trigger customer-account-status-email notification:', err.message);
      }
    }

    res.json({ success: true, message: `Customer account ${newStatus ? 'activated' : 'deactivated'} successfully` });
  } catch (error: any) {
    console.error('[AdminAPI] updateCustomerStatus Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const profile = await prisma.consumerProfile.findUnique({
      where: { id: Number(id) },
      include: { wallets: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Customer profile not found' });
    }

    // Manual Cascade Deletion
    await prisma.$transaction([
      // 1. Delete Wallet Transactions
      prisma.walletTransaction.deleteMany({
        where: { walletId: { in: profile.wallets.map(w => w.id) } }
      }),
      // 2. Delete Wallets
      prisma.wallet.deleteMany({ where: { consumerId: Number(id) } }),
      // 3. Delete Gas Topups and Rewards
      prisma.gasTopup.deleteMany({ where: { consumerId: Number(id) } }),
      prisma.gasReward.deleteMany({ where: { consumerId: Number(id) } }),
      // 4. Delete Gas Meters
      prisma.gasMeter.deleteMany({ where: { consumerId: Number(id) } }),
      // 5. Delete Customer Orders
      prisma.customerOrder.deleteMany({ where: { consumerId: Number(id) } }),
      // 6. Delete Loans
      prisma.loan.deleteMany({ where: { consumerId: Number(id) } }),
      // 7. Unlink or delete NFC cards (unlinking is safer if cards are reusable)
      prisma.nfcCard.updateMany({
        where: { consumerId: Number(id) },
        data: { consumerId: null, status: 'inactive' }
      }),
      // 7.5 Delete Sale Items
      prisma.saleItem.deleteMany({
        where: { sale: { consumerId: Number(id) } }
      }),
      // 8. Delete Sales (if they belong to this consumer)
      prisma.sale.deleteMany({ where: { consumerId: Number(id) } }),
      // 9. Delete Settings
      prisma.consumerSettings.deleteMany({ where: { consumerId: Number(id) } }),
      // 10. Delete Messages and Notifications
      prisma.message.deleteMany({
        where: { OR: [{ senderId: profile.userId }, { receiverId: profile.userId }] }
      }),
      prisma.notification.deleteMany({ where: { userId: profile.userId } }),
      // 11. Delete the profile itself
      prisma.consumerProfile.delete({ where: { id: Number(id) } }),
      // 12. Finally delete the User record
      prisma.user.delete({ where: { id: profile.userId } })
    ]);

    res.json({ success: true, message: 'Customer and all associated data deleted successfully' });
  } catch (error: any) {
    console.error('Delete Customer Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all products (Aggregated by SKU/Name for total stock)
export const getProducts = async (req: AuthRequest, res: Response) => {
  try {
    const rawProducts = await prisma.product.findMany({
      where: {
        status: { not: 'deleted' }
      },
      include: {
        retailerProfile: {
          select: { shopName: true }
        },
        wholesalerProfile: {
          select: { companyName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Aggregate by SKU (fallback to name if sku is missing)
    const groupedMap = new Map();

    rawProducts.forEach(product => {
      const key = product.sku || product.name;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          wholesalerProds: [] as any[],
          retailerProds: [] as any[],
          allProds: [] as any[]
        });
      }
      const entry = groupedMap.get(key);
      entry.allProds.push(product);
      if (product.retailerId !== null) {
        entry.retailerProds.push(product);
      } else {
        entry.wholesalerProds.push(product);
      }
    });

    const products = Array.from(groupedMap.values()).map(entry => {
      const primaryWholesaler = entry.wholesalerProds[0];
      const primaryRetailer = entry.retailerProds[0];
      const representative = primaryWholesaler || primaryRetailer;

      const copy = { ...representative };

      // Sum stock across all records
      copy.stock = entry.allProds.reduce((sum: number, p: any) => sum + (p.stock || 0), 0);

      // Determine clean prices
      copy.supplierPrice = primaryWholesaler ? (primaryWholesaler.costPrice || 0) : 0;
      copy.wholesalerPrice = primaryWholesaler ? (primaryWholesaler.price || 0) : (primaryRetailer ? (primaryRetailer.costPrice || 0) : 0);
      copy.retailerPrice = primaryRetailer ? (primaryRetailer.price || 0) : (primaryWholesaler ? (primaryWholesaler.retailerPrice || 0) : 0);

      return copy;
    });

    res.json({ products });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};


// Create product
export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      description,
      sku,
      category,
      price,
      costPrice,
      retailerPrice,
      stock,
      unit,
      lowStockThreshold,
      invoiceNumber,
      barcode,
      wholesalerId,
      retailerId,
      image
    } = req.body;

    // Upload to Cloudinary if image is provided as base64
    let imageUrl = image;
    if (image && image.startsWith('data:image')) {
      imageUrl = await uploadImage(image);
    }

    const product = await prisma.product.create({
      data: {
        name,
        description,
        sku,
        category,
        price: parseFloat(price),
        costPrice: costPrice ? parseFloat(costPrice) : null,
        retailerPrice: retailerPrice ? parseFloat(retailerPrice) : null,
        stock: parseInt(stock) || 0,
        unit,
        lowStockThreshold: lowStockThreshold ? parseInt(lowStockThreshold) : null,
        invoiceNumber,
        barcode,
        wholesalerId,
        retailerId,
        image: imageUrl,
        status: 'active'
      }
    });

    res.status(201).json({ success: true, product });
  } catch (error: any) {
    console.error('Create Product Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update product (Updates ALL products with the same SKU/Name to enforce Tariff)
export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      sku,
      category,
      price,
      costPrice,
      retailerPrice,
      stock,
      unit,
      lowStockThreshold,
      invoiceNumber,
      barcode,
      status,
      image
    } = req.body;

    const targetProduct = await prisma.product.findUnique({ where: { id: Number(id) } });
    if (!targetProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const whereClause = targetProduct.sku ? { sku: targetProduct.sku } : { name: targetProduct.name };

    // Upload to Cloudinary if new image is provided as base64
    let imageUrl = image;
    if (image && image.startsWith('data:image')) {
      imageUrl = await uploadImage(image);
    }

    const parsedStock = stock !== undefined && stock !== null ? parseFloat(stock) : undefined;

    // Update Wholesaler products (where retailerId is null)
    // Only update stock for wholesaler products if the target product being edited is a wholesaler product
    await prisma.product.updateMany({
      where: {
        ...whereClause,
        retailerId: null
      },
      data: {
        name,
        description,
        sku,
        category,
        price: price ? parseFloat(price) : undefined,
        costPrice: costPrice !== undefined ? (costPrice ? parseFloat(costPrice) : null) : undefined,
        retailerPrice: retailerPrice !== undefined ? (retailerPrice ? parseFloat(retailerPrice) : null) : undefined,
        stock: targetProduct.retailerId === null ? parsedStock : undefined,
        unit,
        lowStockThreshold: lowStockThreshold !== undefined ? (lowStockThreshold ? parseInt(lowStockThreshold) : null) : undefined,
        invoiceNumber,
        barcode,
        status,
        ...(imageUrl ? { image: imageUrl } : {})
      }
    });

    // Update Retailer products (where retailerId is not null)
    // Only update stock for retailer products if the target product being edited is a retailer product
    await prisma.product.updateMany({
      where: {
        ...whereClause,
        retailerId: { not: null }
      },
      data: {
        name,
        description,
        sku,
        category,
        // For retailers, Selling Price is the Retailer Price, and Cost Price is the Wholesaler Price
        price: retailerPrice ? parseFloat(retailerPrice) : undefined,
        costPrice: price ? parseFloat(price) : undefined,
        stock: targetProduct.retailerId !== null ? parsedStock : undefined,
        unit,
        lowStockThreshold: lowStockThreshold !== undefined ? (lowStockThreshold ? parseInt(lowStockThreshold) : null) : undefined,
        invoiceNumber,
        barcode,
        status,
        ...(imageUrl ? { image: imageUrl } : {})
      }
    });


    const product = await prisma.product.findUnique({ where: { id: Number(id) } });
    res.json({ success: true, product });
  } catch (error: any) {
    console.error('Update Product Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Delete product (Deletes ALL products with the same SKU/Name, with soft delete fallback)
export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const targetProduct = await prisma.product.findUnique({ where: { id: Number(id) } });
    if (!targetProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const whereClause = targetProduct.sku ? { sku: targetProduct.sku } : { name: targetProduct.name };

    try {
      // Attempt hard delete (works if the product has never been ordered or sold)
      await prisma.product.deleteMany({ where: whereClause });
      res.json({ success: true, message: 'Products permanently deleted successfully' });
    } catch (dbError: any) {
      // If there are foreign key constraint references (e.g. P2003 error), fall back to soft delete
      console.warn('Hard delete failed due to active constraints. Falling back to soft delete.', dbError.message);
      await prisma.product.updateMany({
        where: whereClause,
        data: { status: 'deleted' }
      });
      res.json({ success: true, message: 'Products soft-deleted successfully' });
    }
  } catch (error: any) {
    console.error('Delete Product Error:', error);
    res.status(500).json({ error: error.message });
  }
};


// ==========================================
// EMPLOYEE MANAGEMENT
// ==========================================

// Get All Employees
export const getEmployees = async (req: AuthRequest, res: Response) => {
  try {
    const employees = await prisma.employeeProfile.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            role: true,
            isActive: true
          }
        }
      }
    });

    // Transform data for frontend
    const formattedEmployees = employees.map(emp => ({
      id: emp.id,
      userId: emp.userId,
      employeeNumber: emp.employeeNumber,
      firstName: emp.user.name ? emp.user.name.split(' ')[0] : 'Unknown', // Basic name splitting
      lastName: emp.user.name ? emp.user.name.split(' ').slice(1).join(' ') : 'Employee',
      email: emp.user.email,
      phone: emp.user.phone,
      department: emp.department,
      position: emp.position,
      salary: emp.salary,
      status: emp.status,
      dateOfJoining: emp.joiningDate,
      bankAccount: emp.bankAccount
    }));

    res.json({ employees: formattedEmployees });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create Employee
export const createEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      department,
      position,
      salary,
      dateOfJoining,
      bankAccount,
      password // Get password from request
    } = req.body;

    const fullName = `${firstName} ${lastName}`;

    // check existing
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email or phone already exists' });
    }

    // Generate random password or use default
    const finalPassword = password || 'employee123';
    const hashedPassword = await hashPassword(finalPassword);

    // Generate Employee Number (simple auto-increment logic or random)
    const count = await prisma.employeeProfile.count();
    const employeeNumber = `EMP${(count + 1).toString().padStart(3, '0')}`;

    // Transaction to create User and Profile
    const result = await prisma.$transaction(async (prisma) => {
      const user = await prisma.user.create({
        data: {
          email,
          phone,
          name: fullName,
          password: hashedPassword,
          role: 'employee',
          isActive: true
        }
      });

      const profile = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          employeeNumber,
          department,
          position,
          salary: Number(salary),
          joiningDate: new Date(dateOfJoining),
          status: 'active',
          bankAccount
        }
      });

      return { user, profile };
    });

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      employee: result
    });

  } catch (error: any) {
    console.error('Create Employee Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update Employee
export const updateEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // This is the EmployeeProfile ID
    const {
      firstName,
      lastName,
      email,
      phone,
      department,
      position,
      salary,
      status,
      dateOfJoining,
      bankAccount
    } = req.body;

    const fullName = `${firstName} ${lastName}`;

    // Find profile first
    const profile = await prisma.employeeProfile.findUnique({
      where: { id: Number(id) },
      include: { user: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Update User and Profile
    await prisma.$transaction([
      prisma.user.update({
        where: { id: profile.userId },
        data: {
          name: fullName,
          email,
          phone,
          isActive: status === 'active'
        }
      }),
      prisma.employeeProfile.update({
        where: { id: Number(id) },
        data: {
          department,
          position,
          salary: Number(salary),
          status, // 'active', 'inactive', 'on_leave'
          joiningDate: new Date(dateOfJoining),
          bankAccount
        }
      })
    ]);

    res.json({ success: true, message: 'Employee updated successfully' });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Delete Employee
export const deleteEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // EmployeeProfile ID

    const profile = await prisma.employeeProfile.findUnique({
      where: { id: Number(id) }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Delete User (Cascade will handle profile deletion if configured, but let's be explicit or rely on schema)
    // In our updated schema we added onDelete: Cascade to the relation.
    // So deleting the User deletes the Profile.

    await prisma.user.delete({
      where: { id: profile.userId }
    });

    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// LOAN MANAGEMENT
// ==========================================

export const approveLoan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);

    // Support Retailer Stock Loans (mapped as 10000 + ID)
    if (numericId > 10000) {
      const realId = numericId - 10000;
      const request = await prisma.creditRequest.findUnique({
        where: { id: realId }
      });

      if (!request) throw new Error('Credit request not found');
      if (request.status !== 'pending') throw new Error('Request already processed');

      await prisma.creditRequest.update({
        where: { id: realId },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewNotes: 'Approved by Admin via Loans Module'
        }
      });

      // Update Retailer Credit
      const credit = await prisma.retailerCredit.findUnique({
        where: { retailerId: request.retailerId }
      });

      if (credit) {
        await prisma.retailerCredit.update({
          where: { id: credit.id },
          data: {
            availableCredit: { increment: request.amount }
          }
        });
      } else {
        await prisma.retailerCredit.create({
          data: {
            retailerId: request.retailerId,
            creditLimit: request.amount,
            availableCredit: request.amount,
            usedCredit: 0
          }
        });
      }


      // Fetch dynamic interest rates from SystemConfig for Retailer
      const systemConfig = await prisma.systemConfig.findFirst();
      const interestRate = systemConfig?.retailerLoanInterest ?? 18;
      const interestAmount = request.amount * (interestRate / 100);
      const totalRepayable = request.amount + interestAmount;

      // Create missing RetailerLoan record to show up in retailer portal
      await (prisma as any).retailerLoan.create({
        data: {
          retailerId: request.retailerId,
          amount: request.amount,
          interestRate,
          totalRepayable,
          remainingAmount: totalRepayable,
          status: 'active'
        }
      });

      return res.json({ success: true, loan: { id: numericId, status: 'approved' } });
    }

    const result = await prisma.$transaction(async (prisma) => {
      const loan = await prisma.loan.findUnique({
        where: { id: numericId },
        include: { consumerProfile: true }
      });

      if (!loan) throw new Error('Loan not found');
      if (loan.status !== 'pending') throw new Error('Loan is already processed');

      // 1. Update Loan status
      const updatedLoan = await prisma.loan.update({
        where: { id: numericId },
        data: {
          status: 'approved',
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      // 2. Get or Create Credit Wallet
      let creditWallet = await prisma.wallet.findFirst({
        where: { consumerId: loan.consumerId, type: 'credit_wallet' }
      });

      if (!creditWallet) {
        creditWallet = await prisma.wallet.create({
          data: {
            consumerId: loan.consumerId,
            type: 'credit_wallet',
            balance: 0,
            currency: 'RWF'
          }
        });
      }

      // 3. Add to Credit Wallet Balance
      await prisma.wallet.update({
        where: { id: creditWallet.id },
        data: { balance: { increment: loan.amount } }
      });

      // 4. Create Transaction
      await prisma.walletTransaction.create({
        data: {
          walletId: creditWallet.id,
          type: 'loan_disbursement',
          amount: loan.amount,
          description: `Loan Approved by Admin`,
          status: 'completed',
          reference: loan.id.toString()
        }
      });

      return updatedLoan;
    }, {
      timeout: 45000 // Increase transaction timeout to 45 seconds to prevent timeout crashes on slow DB queries / high network latency
    });

    res.json({ success: true, loan: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const rejectLoan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const numericId = Number(id);

    if (numericId > 10000) {
      const realId = numericId - 10000;
      await prisma.creditRequest.update({
        where: { id: realId },
        data: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewNotes: reason || 'Rejected by admin'
        }
      });
      return res.json({ success: true, loan: { id: numericId, status: 'rejected' } });
    }

    const loan = await prisma.loan.update({
      where: { id: numericId },
      data: { status: 'rejected' }
    });

    res.json({ success: true, loan });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// NFC CARD MANAGEMENT
// ==========================================

export const registerNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const {
      uid,
      pin,
      cardType,
      cardholderName,
      nationalId,
      phone,
      email,
      province,
      district,
      sector,
      cell,
      streetAddress,
      landmark,
      userId // Optional: Valid User ID passed from frontend
    } = req.body;

    if (!uid) return res.status(400).json({ error: 'UID is required' });

    const existing = await prisma.nfcCard.findUnique({ where: { uid } });
    if (existing) return res.status(400).json({ error: 'NFC Card with this UID already exists' });

    // Try to link to a consumer
    let consumerId = null;
    let finalStatus = 'active';

    // 1. If userId provided explicitly
    if (userId) {
      const profile = await prisma.consumerProfile.findFirst({ where: { userId: Number(userId) } }); // Assuming userId is User model ID
      if (profile) consumerId = profile.id;
      else {
        // Maybe it WAS the consumerProfile ID?
        const profileById = await prisma.consumerProfile.findUnique({ where: { id: Number(userId) } });
        if (profileById) consumerId = profileById.id;
      }
    }
    // 2. If no userId, try to match by phone
    else if (phone) {
      const user = await prisma.user.findFirst({ where: { phone } });
      if (user) {
        const profile = await prisma.consumerProfile.findUnique({ where: { userId: user.id } });
        if (profile) consumerId = profile.id;
      }
    }

    // CLIENT REQUIREMENT: Reject creation if not linked to valid existing customer
    if (!consumerId) {
      return res.status(400).json({ error: 'NFC cards must be assigned only to an existing customer account.' });
    }

    const card = await prisma.nfcCard.create({
      data: {
        uid,
        pin: pin || '1234',
        status: finalStatus,
        balance: 0,
        cardType,
        cardholderName,
        nationalId,
        phone,
        email,
        province,
        district,
        sector,
        cell,
        streetAddress,
        landmark,
        consumerId: consumerId
      }
    });

    res.status(201).json({ success: true, card, message: 'Card registered and linked to customer' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getNFCCardTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Find the card and its linked consumer
    const card = await prisma.nfcCard.findUnique({
      where: { id: Number(id) }
    });

    if (!card) {
      return res.status(404).json({ success: false, error: 'Card not found' });
    }

    if (!card.consumerId) {
      return res.json({ success: true, transactions: [] });
    }

    // Fetch both regular retail sales and gas recharges performed by this consumer using NFC
    const [sales, gasRecharges] = await Promise.all([
      prisma.sale.findMany({
        where: {
          consumerId: card.consumerId,
          paymentMethod: 'nfc_card'
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      prisma.gasRechargeTransaction.findMany({
        where: {
          customerId: card.consumerId,
          paymentMethod: 'nfc_card'
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ]);

    // Map both formats to a unified representation for display in the frontend table
    const transactions = [
      ...sales.map(s => ({
        id: `SALE-${s.id}`,
        type: 'Retail Purchase',
        amount: s.totalAmount,
        status: s.status,
        date: s.createdAt,
        details: s.meterId ? `Reference: ${s.meterId}` : 'Standard Purchase'
      })),
      ...gasRecharges.map(g => ({
        id: `GAS-${g.id}`,
        type: `Gas Recharge (${g.meterType})`,
        amount: g.amount,
        status: g.status,
        date: g.createdAt,
        details: `Meter: ${g.meterNumber}`
      }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json({ success: true, transactions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const blockNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const card = await prisma.nfcCard.update({
      where: { id: Number(id) },
      data: { status: 'blocked' }
    });
    res.json({ success: true, card });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const activateNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const card = await prisma.nfcCard.update({
      where: { id: Number(id) },
      data: { status: 'available' }
    });
    res.json({ success: true, card });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const unlinkNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const card = await prisma.nfcCard.update({
      where: { id: Number(id) },
      data: {
        consumerId: null,
        retailerId: null,
        status: 'available' // Reset to available upon unlink
      }
    });
    res.json({ success: true, card });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// REPORTS
// ==========================================

export const getTransactionReport = async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, groupBy } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const txs = await prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    });

    // Group by period
    const report: any[] = [];
    const grouped: Record<string, any> = {};

    txs.forEach(tx => {
      const date = new Date(tx.createdAt);
      let period = '';
      if (groupBy === 'month') {
        period = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      } else {
        period = date.toISOString().split('T')[0];
      }

      // Map types to frontend expectations
      let type = tx.type;
      if (type === 'topup' || type === 'top_up') type = 'wallet_topup';
      if (type === 'gas_payment' || type === 'gas_topup') type = 'gas_purchase';
      if (type === 'loan' || type === 'disbursement') type = 'loan_disbursement';
      if (type === 'nfc') type = 'nfc_payment';

      const key = `${period}_${type}`;
      if (!grouped[key]) {
        grouped[key] = { period, type, count: 0, total_amount: 0 };
      }
      grouped[key].count += 1;
      grouped[key].total_amount = Math.round(grouped[key].total_amount + tx.amount);
    });

    res.json({ success: true, report: Object.values(grouped) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getRevenueReport = async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, groupBy } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    // Revenue comes from Sales and GasTopups
    const [sales, gasTopups] = await Promise.all([
      prisma.sale.findMany({ where, orderBy: { createdAt: 'asc' } }),
      prisma.gasTopup.findMany({ where, orderBy: { createdAt: 'asc' } })
    ]);

    const grouped: Record<string, any> = {};

    sales.forEach(s => {
      const date = new Date(s.createdAt);
      let period = groupBy === 'month'
        ? `${date.getFullYear()}-${(date.getMonth() + 0).toString().padStart(2, '0')}` // Using 0 based or 1 based? Let's use 1 based to be consistent
        : date.toISOString().split('T')[0];

      // Fix month calculation to be 1-based
      if (groupBy === 'month') {
        period = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      }

      if (!grouped[period]) {
        grouped[period] = { period, order_revenue: 0, order_count: 0, gas_revenue: 0, gas_count: 0 };
      }
      grouped[period].order_revenue = Math.round(grouped[period].order_revenue + s.totalAmount);
      grouped[period].order_count += 1;
    });

    gasTopups.forEach(g => {
      const date = new Date(g.createdAt);
      let period = groupBy === 'month'
        ? `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`
        : date.toISOString().split('T')[0];

      if (!grouped[period]) {
        grouped[period] = { period, order_revenue: 0, order_count: 0, gas_revenue: 0, gas_count: 0 };
      }
      grouped[period].gas_revenue = Math.round(grouped[period].gas_revenue + g.amount);
      grouped[period].gas_count += 1;
    });

    res.json({ success: true, orders: Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period)) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// SYSTEM CONFIGURATION
// ==========================================

const customRatesPath = path.join(__dirname, '..', 'customRates.json');

const getCustomRates = () => {
  try {
    if (fs.existsSync(customRatesPath)) {
      const data = fs.readFileSync(customRatesPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error reading custom rates:', e);
  }
  return {
    customerInterestRate: 10,
    retailerInterestRate: 5,
    wholesalerInterestRate: 8
  };
};

const saveCustomRates = (rates: any) => {
  try {
    const existing = getCustomRates();
    const updated = {
      ...existing,
      customerInterestRate: rates.customerInterestRate !== undefined ? Number(rates.customerInterestRate) : existing.customerInterestRate,
      retailerInterestRate: rates.retailerInterestRate !== undefined ? Number(rates.retailerInterestRate) : existing.retailerInterestRate,
      wholesalerInterestRate: rates.wholesalerInterestRate !== undefined ? Number(rates.wholesalerInterestRate) : existing.wholesalerInterestRate
    };
    fs.writeFileSync(customRatesPath, JSON.stringify(updated, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving custom rates:', e);
  }
};

export const getSystemConfig = async (req: AuthRequest, res: Response) => {
  try {
    let config = await prisma.systemConfig.findFirst();

    // Create default config if it doesn't exist
    if (!config) {
      const defaultData: any = {
        retailerShare: 60,
        companyShare: 28,
        gasRewardShare: 12,
        gasPricePerM3: 850,
        minGasTopup: 500,
        maxGasTopup: 100000,
        minWalletTopup: 500,
        maxWalletTopup: 500000,
        maxDailyTransaction: 1000000,
        maxCreditLimit: 500000,
        wholesalerMarkup: 20,
        retailerMarkup: 20,
        maxDiscountPercentage: 5,
        exciseDutyRate: 10
      };
      config = await prisma.systemConfig.create({
        data: defaultData
      });
    }

    const rates = getCustomRates();
    res.json({ success: true, config: { ...config, ...rates } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

const recalculateAllProductsBackground = async (config: any) => {
  try {
    console.log('🔄 Starting background recalculation of all product prices...');

    // Fetch all products that have a supplierCost set (to avoid messing up legacy products without costs)
    const products = await prisma.product.findMany({
      where: {
        wholesalerId: { not: null },
        supplierCost: { not: null }
      } as any
    });


    const wholesalerMarkupPct = config?.wholesalerMarkup || 20;
    const retailerMarkupPct = config?.retailerMarkup || 25;
    const exciseDutyRatePct = config?.exciseDutyRate || 10;

    console.log(`📦 Found ${products.length} products to recalculate. Using Markups: W=${wholesalerMarkupPct}%, R=${retailerMarkupPct}%`);

    let updatedCount = 0;
    for (const product of products) {
      const prodAny = product as any;
      if (prodAny.supplierCost === null || prodAny.supplierCost === undefined) continue;

      const taxType = prodAny.taxType || 'B';

      // 1. Calculate Wholesaler Price
      const wholesalePricing = calculateWholesalePrice(
        prodAny.supplierCost,
        wholesalerMarkupPct,
        taxType,
        exciseDutyRatePct
      );

      // 2. Calculate Retailer Price (using the wholesaler's pre-tax price as the retailer's clean base cost)
      const retailPricing = calculateRetailPrice(
        wholesalePricing.preTaxPrice,
        retailerMarkupPct,
        taxType,
        exciseDutyRatePct
      );

      // 3. Update Product
      await prisma.product.update({
        where: { id: product.id },
        data: {
          price: wholesalePricing.finalInvoicePrice,
          retailerPrice: retailPricing.finalConsumerShelfPrice
        }
      });
      updatedCount++;
    }

    console.log(`✅ Background recalculation complete for wholesaler products. Updated ${updatedCount} products.`);

    // --- RETAILER PRODUCTS ---
    console.log(`🔄 Starting background recalculation of retailer product prices...`);
    const retailerProducts = await prisma.product.findMany({
      where: {
        retailerId: { not: null },
        costPrice: { not: null }
      }
    });

    console.log(`📦 Found ${retailerProducts.length} retailer products to recalculate. Using Markup: R=${retailerMarkupPct}%`);

    let retailUpdatedCount = 0;
    for (const rProduct of retailerProducts) {
      const rProdAny = rProduct as any;
      if (rProduct.costPrice === null || rProduct.costPrice === undefined) continue;

      // Find the corresponding wholesaler product robustly to get the correct live taxType
      const wholesalerProduct = await prisma.product.findFirst({
        where: {
          retailerId: null,
          wholesalerId: { not: null },
          OR: [
            rProduct.sku ? { sku: rProduct.sku } : { id: -1 },
            rProduct.barcode ? { barcode: rProduct.barcode } : { id: -1 },
            { name: rProduct.name }
          ]
        }
      });

      const taxType = wholesalerProduct?.taxType || rProdAny.taxType || 'B';

      const retailPricing = calculateRetailPrice(
        rProduct.costPrice,
        retailerMarkupPct,
        taxType,
        exciseDutyRatePct
      );

      await prisma.product.update({
        where: { id: rProduct.id },
        data: {
          price: retailPricing.finalConsumerShelfPrice,
          taxType: taxType
        }
      });
      retailUpdatedCount++;
    }

    console.log(`✅ Background recalculation complete for retailer products. Updated ${retailUpdatedCount} products.`);
  } catch (error) {
    console.error('❌ Error during background product recalculation:', error);
  }
};

export const updateSystemConfig = async (req: AuthRequest, res: Response) => {
  try {
    const data = { ...req.body };
    saveCustomRates(data);

    delete data.customerInterestRate;
    delete data.retailerInterestRate;
    delete data.wholesalerInterestRate;

    let config = await prisma.systemConfig.findFirst();

    if (!config) {
      config = await prisma.systemConfig.create({ data });
    } else {
      config = await prisma.systemConfig.update({
        where: { id: config.id },
        data
      });
    }

    // Await background recalculation so that subsequent navigation shows updated prices immediately
    try {
      await recalculateAllProductsBackground(config);
    } catch (err) {
      console.error('❌ Error triggering recalculation:', err);
    }

    const rates = getCustomRates();
    res.json({ success: true, config: { ...config, ...rates } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// ADMIN REAL-TIME READ-ONLY ACCOUNT ACCESS
// ==========================================

// Get comprehensive real-time customer account details (READ-ONLY)
export const getCustomerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const customer = await prisma.consumerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        linkedRetailer: true,
        wallets: {
          include: {
            walletTransactions: {
              orderBy: { createdAt: 'desc' },
              take: 50
            }
          }
        },
        nfcCards: true,
        gasMeters: true,
        gasTopups: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            gasMeter: true
          }
        },
        gasRewards: {
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        loans: {
          orderBy: { createdAt: 'desc' }
        },
        sales: {
          orderBy: { createdAt: 'desc' },
          include: {
            saleItems: {
              include: {
                product: true
              }
            }
          }
        },
        customerOrders: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    // Calculate actual total gas rewards units
    const gasRewardsSum = await prisma.gasReward.aggregate({
      where: { consumerId: customer.id },
      _sum: { units: true }
    });

    // Calculate wallet balances
    const walletSummary = {
      dashboardWallet: customer.wallets.find(w => w.type === 'dashboard_wallet')?.balance || 0,
      rewardsWallet: customer.wallets.find(w => w.type === 'rewards_wallet')?.balance || 0,
      gasRewardsWallet: gasRewardsSum._sum.units || 0,
      creditWallet: customer.wallets.find(w => w.type === 'credit_wallet')?.balance || 0,
      gasBalance: customer.gasMeters.reduce((sum, m) => sum + (m.currentUnits || 0), 0)
    };

    // Fetch retailer profiles to link shop names for sales
    const retailerIds = [...new Set(customer.sales.map(s => s.retailerId))];
    const retailers = await prisma.retailerProfile.findMany({
      where: { id: { in: retailerIds } },
      select: { id: true, shopName: true }
    });
    const retailerMap = new Map(retailers.map(r => [r.id, r]));

    // Format Sales (Retail Orders)
    const formattedSales = customer.sales.map(s => ({
      ...s,
      retailerProfile: retailerMap.get(s.retailerId) || { id: s.retailerId, shopName: 'Unknown Retailer' }
    }));

    // Format customerOrders (Gas / Service Orders)
    const formattedGasOrders = customer.customerOrders.map(co => ({
      id: co.id,
      retailerProfile: { id: 'GAS_SERVICE', shopName: 'Big Gas Service' },
      totalAmount: co.amount,
      status: co.status,
      createdAt: co.createdAt,
      type: 'gas'
    }));

    // Combine and sort consolidated orders by date descending
    const consolidatedOrders = [...formattedSales, ...formattedGasOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Filter completed and cancelled orders based on linked retailer's lastSettlementDate
    const lastSettlementDate = customer.linkedRetailer?.lastSettlementDate ? new Date(customer.linkedRetailer.lastSettlementDate) : null;

    const filteredCompletedOrders = consolidatedOrders.filter(s => {
      const isCompleted = s.status === 'completed' || s.status === 'delivered';
      if (!isCompleted) return false;
      if (lastSettlementDate) {
        return new Date(s.createdAt) > lastSettlementDate;
      }
      return true;
    });

    const filteredCancelledOrders = consolidatedOrders.filter(s => {
      const isCancelled = s.status === 'cancelled';
      if (!isCancelled) return false;
      if (lastSettlementDate) {
        return new Date(s.createdAt) > lastSettlementDate;
      }
      return true;
    });

    // Order statistics (completed/cancelled reset for new periods)
    const orderStats = {
      pending: consolidatedOrders.filter(s => s.status === 'pending').length,
      active: consolidatedOrders.filter(s => s.status === 'processing' || s.status === 'active').length,
      completed: filteredCompletedOrders.length,
      cancelled: filteredCancelledOrders.length,
      total: consolidatedOrders.filter(s => s.status === 'pending' || s.status === 'processing' || s.status === 'active').length + filteredCompletedOrders.length + filteredCancelledOrders.length
    };

    // Get all transactions from all wallets
    const allTransactions = customer.wallets.flatMap(w =>
      w.walletTransactions.map(t => ({
        ...t,
        walletType: w.type
      }))
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Fetch global lastGasResetDate
    const resetAlert = await prisma.systemAlert.findFirst({
      where: { apiName: 'GAS_REPORTING_PERIOD_RESET' },
      orderBy: { createdAt: 'desc' }
    });
    const lastGasResetDate = resetAlert ? new Date(resetAlert.errorMessage) : null;

    // Calculate actual total gas top-ups stats
    const totalGasTopupsSum = await prisma.gasTopup.aggregate({
      where: {
        consumerId: customer.id,
        status: { in: ['completed', 'success'] },
        ...(lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {})
      },
      _count: { id: true },
      _sum: { amount: true, units: true }
    });

    const totalGasRewardsSum = await prisma.gasReward.aggregate({
      where: {
        consumerId: customer.id,
        units: { gt: 0 },
        ...(lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {})
      },
      _sum: { units: true }
    });

    // Gas usage summary
    const gasUsage = {
      totalTopups: totalGasTopupsSum._count.id || 0,
      totalAmount: totalGasTopupsSum._sum.amount || 0,
      totalUnits: totalGasTopupsSum._sum.units || 0,
      totalRewards: totalGasRewardsSum._sum.units || 0
    };

    // Last order details
    const lastOrder = consolidatedOrders.length > 0 ? consolidatedOrders[0] : null;

    // Supplier chain - find linked retailers from sales
    const linkedRetailers = Array.from(new Set(formattedSales.map(s => s.retailerProfile?.id).filter(Boolean)));
    const supplierChain = await prisma.retailerProfile.findMany({
      where: { id: { in: linkedRetailers as number[] } },
      include: {
        linkedWholesaler: {
          select: { id: true, companyName: true }
        }
      }
    });

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: customer.id,
          userId: customer.userId,
          fullName: customer.fullName,
          phone: customer.user.phone,
          email: customer.user.email,
          membershipType: customer.membershipType,
          isVerified: customer.isVerified,
          isActive: customer.user.isActive,
          createdAt: customer.user.createdAt
        },
        walletSummary,
        wallets: customer.wallets.map(w => ({
          id: w.id,
          type: w.type,
          balance: w.balance,
          currency: w.currency
        })),
        orderStats,
        orders: consolidatedOrders,
        transactionHistory: allTransactions,
        nfcCards: customer.nfcCards.map(card => ({
          id: card.id,
          uid: card.uid,
          status: card.status,
          balance: card.balance,
          cardType: card.cardType,
          createdAt: card.createdAt
        })),
        gasMeters: customer.gasMeters,
        gasUsage,
        gasTopups: customer.gasTopups,
        gasRewards: customer.gasRewards,
        loans: customer.loans.map(loan => ({
          id: loan.id,
          amount: loan.amount,
          status: loan.status,
          dueDate: loan.dueDate,
          createdAt: loan.createdAt
        })),
        lastOrder,
        supplierChain: supplierChain.map(r => ({
          retailerId: r.id,
          retailerName: r.shopName,
          wholesalerId: r.linkedWholesaler?.id,
          wholesalerName: r.linkedWholesaler?.companyName
        }))
      }
    });
  } catch (error: any) {
    console.error('Get Customer Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get comprehensive real-time retailer account details (READ-ONLY)
export const getRetailerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const retailer = await prisma.retailerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        credit: true,
        linkedWholesaler: {
          select: { id: true, companyName: true, lastSettlementDate: true, user: { select: { phone: true, email: true } } }
        },
        branches: {
          include: { terminals: true }
        },
        nfcCards: true,
        retailerLoans: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            wholesalerProfile: { select: { companyName: true } },
            orderItems: { include: { product: true } }
          }
        },
        sales: {
          orderBy: { createdAt: 'desc' },
          include: {
            consumerProfile: { include: { user: { select: { phone: true } } } },
            saleItems: { include: { product: true } }
          }
        },
        creditRequests: {
          orderBy: { createdAt: 'desc' }
        },
        inventory: true
      }
    });

    if (!retailer) {
      return res.status(404).json({ success: false, error: 'Retailer not found' });
    }

    // Filter completed/cancelled orders to wholesaler based on Wholesaler's lastSettlementDate
    const wholesalerSettlementDate = retailer.linkedWholesaler?.lastSettlementDate ? new Date(retailer.linkedWholesaler.lastSettlementDate) : null;
    const filteredWholesalerCompleted = retailer.orders.filter(o => {
      const isCompleted = o.status === 'completed' || o.status === 'delivered';
      if (!isCompleted) return false;
      if (wholesalerSettlementDate) {
        return new Date(o.createdAt) > wholesalerSettlementDate;
      }
      return true;
    });

    const filteredWholesalerCancelled = retailer.orders.filter(o => {
      const isCancelled = o.status === 'cancelled';
      if (!isCancelled) return false;
      if (wholesalerSettlementDate) {
        return new Date(o.createdAt) > wholesalerSettlementDate;
      }
      return true;
    });

    // Order statistics (orders TO wholesalers)
    const orderStats = {
      pending: retailer.orders.filter(o => o.status === 'pending').length,
      active: retailer.orders.filter(o => o.status === 'processing' || o.status === 'active').length,
      completed: filteredWholesalerCompleted.length,
      cancelled: filteredWholesalerCancelled.length,
      total: retailer.orders.filter(o => o.status === 'pending' || o.status === 'processing' || o.status === 'active').length + filteredWholesalerCompleted.length + filteredWholesalerCancelled.length
    };

    // Filter sales to customers since last settlement date
    const retailerSettlementDate = retailer.lastSettlementDate ? new Date(retailer.lastSettlementDate) : null;

    // For revenue: retailer dashboard counts all non-cancelled sales since last settlement date
    const filteredCustomerRevenueSales = retailer.sales.filter(s => {
      if (s.status === 'cancelled') return false;
      if (retailerSettlementDate) {
        return new Date(s.createdAt) >= retailerSettlementDate;
      }
      return true;
    });

    const filteredCustomerCompleted = retailer.sales.filter(s => {
      const isCompleted = s.status === 'completed' || s.status === 'delivered';
      if (!isCompleted) return false;
      if (retailerSettlementDate) {
        return new Date(s.createdAt) >= retailerSettlementDate;
      }
      return true;
    });

    const filteredCustomerCancelled = retailer.sales.filter(s => {
      const isCancelled = s.status === 'cancelled';
      if (!isCancelled) return false;
      if (retailerSettlementDate) {
        return new Date(s.createdAt) >= retailerSettlementDate;
      }
      return true;
    });

    // Fetch gas rewards given
    const gasRewardsAggregate = await prisma.gasReward.aggregate({
      where: {
        sale: {
          retailerId: retailer.id
        },
        ...(retailerSettlementDate ? ({ createdAt: { gte: retailerSettlementDate } } as any) : {})
      },
      _sum: {
        units: true
      }
    });

    const systemConfig = await prisma.systemConfig.findFirst();
    const gasRewardsM3 = gasRewardsAggregate._sum.units || 0;
    const gasRewardsRwf = Math.round(gasRewardsM3 * (systemConfig?.gasPricePerM3 || 6500));

    // Sales statistics (sales TO consumers)
    const salesStats = {
      pending: retailer.sales.filter(s => s.status === 'pending').length,
      processing: retailer.sales.filter(s => s.status === 'processing' || s.status === 'confirmed').length,
      shipped: retailer.sales.filter(s => s.status === 'shipped').length,
      ready: retailer.sales.filter(s => s.status === 'ready').length,
      completed: filteredCustomerCompleted.length,
      cancelled: filteredCustomerCancelled.length,
      total: retailer.sales.filter(s => s.status === 'pending').length + filteredCustomerCompleted.length + filteredCustomerCancelled.length,
      totalRevenue: filteredCustomerRevenueSales.reduce((sum, s) => sum + s.totalAmount, 0),
      dashboardWalletRevenue: filteredCustomerRevenueSales.filter(s => s.paymentMethod === 'dashboard_wallet' || s.paymentMethod === 'wallet').reduce((sum, s) => sum + s.totalAmount, 0),
      creditWalletRevenue: filteredCustomerRevenueSales.filter(s => s.paymentMethod === 'credit_wallet' || s.paymentMethod === 'credit').reduce((sum, s) => sum + s.totalAmount, 0),
      mobileMoneyRevenue: filteredCustomerRevenueSales.filter(s => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0),
      gasRewardsM3,
      gasRewardsRwf,
    };

    // Calculate spendable credit (Wholesaler Credit) from loans matching retailer portal AddStockPage.tsx
    const loansWithCredit = (retailer.retailerLoans || []).filter(l => (l.amount || 0) > 0);
    const totalSpendableCredit = loansWithCredit.reduce((sum, l) => sum + (l.amount || 0), 0);

    // Outstanding loan balance — sum of remainingAmount on active loans (matches retailer WalletPage Credit tab)
    const activeLoans = (retailer.retailerLoans || []).filter((l: any) => l.status?.toLowerCase() === 'active');
    const outstandingLoanBalance = activeLoans.reduce((sum: number, l: any) => sum + (l.remainingAmount || 0), 0);

    // Credit summary
    const creditSummary = retailer.credit ? {
      creditLimit: retailer.credit.creditLimit,
      usedCredit: retailer.credit.usedCredit,
      availableCredit: totalSpendableCredit > 0 ? totalSpendableCredit : retailer.credit.availableCredit
    } : {
      creditLimit: retailer.creditLimit,
      usedCredit: 0,
      availableCredit: totalSpendableCredit > 0 ? totalSpendableCredit : retailer.creditLimit
    };

    // Profit Wallet — realized profit from sales (sellingPrice - costPrice) matching retailer dashboard
    // Only includes sales after lastSettlementDate (same reset behavior as retailer's own Profit Wallet tab)
    const retailerMarkup = (systemConfig as any)?.retailerMarkup || 20;
    const settlementDateForProfit = retailer.lastSettlementDate ? new Date(retailer.lastSettlementDate) : null;
    let totalSalesRevenue = 0;
    let totalSalesCost = 0;
    for (const sale of retailer.sales) {
      if (sale.status === 'cancelled') continue;
      // Apply same date filter as retailer dashboard: only count sales after lastSettlementDate
      if (settlementDateForProfit && new Date(sale.createdAt) < settlementDateForProfit) continue;
      for (const item of (sale as any).saleItems || []) {
        const revenue = (item.price || 0) * (item.quantity || 0);
        const cost = item.product?.costPrice && item.product.costPrice > 0
          ? item.product.costPrice
          : (item.price || 0) / (1 + retailerMarkup / 100);
        totalSalesRevenue += revenue;
        totalSalesCost += cost * (item.quantity || 0);
      }
    }
    const profitWallet = Math.max(0, totalSalesRevenue - totalSalesCost);

    // Last order details
    const lastOrder = retailer.orders.length > 0 ? retailer.orders[0] : null;

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: retailer.id,
          userId: retailer.userId,
          shopName: retailer.shopName,
          address: retailer.address,
          phone: retailer.user.phone,
          email: retailer.user.email,
          isVerified: retailer.isVerified,
          isActive: retailer.user.isActive,
          createdAt: retailer.user.createdAt
        },
        walletBalance: retailer.walletBalance,
        profitWallet,
        outstandingLoanBalance,
        creditSummary,
        orderStats,
        orders: retailer.orders,
        salesStats,
        sales: retailer.sales,
        nfcCards: retailer.nfcCards.map(card => ({
          id: card.id,
          uid: card.uid,
          status: card.status,
          balance: card.balance,
          cardType: card.cardType,
          createdAt: card.createdAt
        })),
        branches: retailer.branches,
        inventory: {
          totalProducts: retailer.inventory.length,
          lowStock: retailer.inventory.filter(p => p.lowStockThreshold && p.stock <= p.lowStockThreshold).length,
          outOfStock: retailer.inventory.filter(p => p.stock === 0).length
        },
        products: retailer.inventory.map(p => ({
          ...p,
          profitMargin: retailerMarkup
        })),
        creditRequests: retailer.creditRequests,
        lastOrder,
        linkedWholesaler: retailer.linkedWholesaler ? {
          id: retailer.linkedWholesaler.id,
          companyName: retailer.linkedWholesaler.companyName,
          phone: retailer.linkedWholesaler.user?.phone,
          email: retailer.linkedWholesaler.user?.email
        } : null
      }
    });
  } catch (error: any) {
    console.error('Get Retailer Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get comprehensive real-time worker/employee account details (READ-ONLY)
export const getWorkerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employeeProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        attendances: {
          orderBy: { date: 'desc' },
          take: 30
        },
        leaveRequests: {
          orderBy: { createdAt: 'desc' }
        },
        billPayments: {
          orderBy: { createdAt: 'desc' }
        },
        enrollments: {
          include: {
            course: true,
            lessonProgress: true
          }
        },
        assignedTasks: {
          orderBy: { createdAt: 'desc' },
          include: {
            project: true
          }
        },
        projectMembers: {
          include: {
            project: true
          }
        }
      }
    });

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    // Attendance summary
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const monthlyAttendance = employee.attendances.filter(a => new Date(a.date) >= thisMonth);
    const attendanceSummary = {
      presentDays: monthlyAttendance.filter(a => a.status === 'present').length,
      absentDays: monthlyAttendance.filter(a => a.status === 'absent').length,
      lateDays: monthlyAttendance.filter(a => a.status === 'late').length,
      totalWorkHours: monthlyAttendance.reduce((sum, a) => sum + a.workHours, 0)
    };

    // Task statistics
    const taskStats = {
      todo: employee.assignedTasks.filter(t => t.status === 'TODO').length,
      inProgress: employee.assignedTasks.filter(t => t.status === 'IN_PROGRESS').length,
      completed: employee.assignedTasks.filter(t => t.status === 'COMPLETED').length,
      total: employee.assignedTasks.length
    };

    // Training progress
    const trainingProgress = employee.enrollments.map(e => ({
      courseId: e.courseId,
      courseTitle: e.course.title,
      progress: e.progress,
      status: e.status,
      completedLessons: e.lessonProgress.filter(lp => lp.completed).length,
      totalLessons: e.course.totalLessons
    }));

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: employee.id,
          userId: employee.userId,
          employeeNumber: employee.employeeNumber,
          name: employee.user.name,
          phone: employee.user.phone,
          email: employee.user.email,
          department: employee.department,
          position: employee.position,
          joiningDate: employee.joiningDate,
          status: employee.status,
          isActive: employee.user.isActive
        },
        salary: employee.salary,
        bankAccount: employee.bankAccount,
        attendanceSummary,
        recentAttendance: employee.attendances,
        leaveRequests: employee.leaveRequests,
        taskStats,
        tasks: employee.assignedTasks,
        projects: employee.projectMembers.map(pm => ({
          projectId: pm.project.id,
          projectName: pm.project.name,
          role: pm.role,
          status: pm.project.status,
          progress: pm.project.progress
        })),
        trainingProgress,
        billPayments: employee.billPayments
      }
    });
  } catch (error: any) {
    console.error('Get Worker Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get wholesaler account details with linked retailers (READ-ONLY)
export const getWholesalerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const wholesaler = await prisma.wholesalerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        linkedRetailers: {
          include: {
            user: { select: { phone: true, email: true, isActive: true } },
            credit: true
          }
        },
        receivedOrders: {
          orderBy: { createdAt: 'desc' },
          include: {
            retailerProfile: { select: { shopName: true } },
            orderItems: { include: { product: true } }
          }
        },
        inventory: true,
        suppliers: {
          include: {
            supplierPayments: {
              orderBy: { paymentDate: 'desc' },
              take: 10
            }
          }
        },
        supplierPayments: {
          orderBy: { paymentDate: 'desc' },
          take: 50
        }
      }
    });

    if (!wholesaler) {
      return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    // Order statistics
    const dateFilter = wholesaler.lastSettlementDate ? { gte: wholesaler.lastSettlementDate } : undefined;
    const dateFilteredOrders = wholesaler.receivedOrders.filter(o => !dateFilter || new Date(o.createdAt) >= new Date(dateFilter.gte));
    const completedOrders = dateFilteredOrders.filter(o => o.status === 'delivered');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const orderStats = {
      pending: wholesaler.receivedOrders.filter(o => o.status === 'pending').length,
      active: wholesaler.receivedOrders.filter(o => o.status === 'processing').length,
      completed: wholesaler.receivedOrders.filter(o => o.status === 'completed' || o.status === 'delivered').length,
      cancelled: wholesaler.receivedOrders.filter(o => o.status === 'cancelled').length,
      total: wholesaler.receivedOrders.length,
      totalRevenue: totalRevenue
    };

    // Calculate profit wallet (realized profit from confirmed sales/revenue) matching wholesaler dashboard
    const systemConfig = await prisma.systemConfig.findFirst();
    const wholesalerMarkupPct = (systemConfig as any)?.wholesalerMarkup || 20;

    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          wholesalerId: wholesaler.id,
          ...(dateFilter ? { createdAt: dateFilter } : {})
        }
      },
      include: { product: true }
    });

    const confirmedOrderItems = orderItems.filter(item => {
      const order = wholesaler.receivedOrders.find(o => o.id === item.orderId);
      return order && ['confirmed', 'shipped', 'delivered'].includes(order.status);
    });

    const profitWallet = confirmedOrderItems.reduce((sum, item) => {
      const rawCost = item.product.supplierCost !== null && item.product.supplierCost !== undefined && item.product.supplierCost > 0
        ? item.product.supplierCost
        : (item.product.costPrice || 0);
      const cost = rawCost > 0 ? rawCost : item.price / (1 + wholesalerMarkupPct / 100);
      return sum + (item.quantity * (item.price - cost));
    }, 0);

    // Last order
    const lastOrder = wholesaler.receivedOrders.length > 0 ? wholesaler.receivedOrders[0] : null;

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: wholesaler.id,
          userId: wholesaler.userId,
          companyName: wholesaler.companyName,
          contactPerson: wholesaler.contactPerson,
          tinNumber: wholesaler.tinNumber,
          address: wholesaler.address,
          phone: wholesaler.user.phone,
          email: wholesaler.user.email,
          isVerified: wholesaler.isVerified,
          isActive: wholesaler.user.isActive,
          createdAt: wholesaler.user.createdAt
        },
        linkedRetailers: wholesaler.linkedRetailers.map(r => ({
          id: r.id,
          shopName: r.shopName,
          phone: r.user.phone,
          email: r.user.email,
          isActive: r.user.isActive,
          creditLimit: r.credit?.creditLimit || r.creditLimit,
          usedCredit: r.credit?.usedCredit || 0
        })),
        orderStats,
        orders: wholesaler.receivedOrders,
        inventory: {
          totalProducts: wholesaler.inventory.length,
          lowStock: wholesaler.inventory.filter(p => p.lowStockThreshold && p.stock <= p.lowStockThreshold).length,
          outOfStock: wholesaler.inventory.filter(p => p.stock === 0).length
        },
        products: wholesaler.inventory,
        suppliers: wholesaler.suppliers,
        supplierPayments: wholesaler.supplierPayments,
        profitWallet,
        lastOrder
      }
    });
  } catch (error: any) {
    console.error('Get Wholesaler Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// ADMIN PROXY — WHOLESALER ORDER ACTIONS
// Admin can perform the same order actions as the wholesaler,
// identified by wholesaler profile ID from the URL.
// ==========================================

export const adminConfirmWholesalerOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { wId, orderId } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { id: Number(wId) },
      include: { user: true }
    });
    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    const order = await prisma.order.findUnique({ where: { id: Number(orderId) } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.wholesalerId !== wholesalerProfile.id) {
      return res.status(403).json({ success: false, error: 'Order does not belong to this wholesaler' });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot confirm order with status: ${order.status}` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const orderWithItems = await tx.order.findUnique({
        where: { id: Number(orderId) },
        include: { orderItems: { include: { product: true } } }
      });
      if (!orderWithItems) throw new Error('Order not found');

      for (const item of orderWithItems.orderItems) {
        if (!item.product) throw new Error(`Product not found for item ${item.productId}`);
        if (item.product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${item.product.name}. Available: ${item.product.stock}, Required: ${item.quantity}`);
        }
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        });
      }

      const updatedOrder = await tx.order.update({
        where: { id: Number(orderId) },
        data: { status: 'confirmed' },
        include: { orderItems: { include: { product: true } }, retailerProfile: { include: { user: true } } }
      });

      return updatedOrder;
    }, { timeout: 15000 });

    res.json({ success: true, order: result, message: 'Order confirmed and stock deducted successfully' });
  } catch (error: any) {
    console.error('Admin Confirm Wholesaler Order Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const adminRejectWholesalerOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { wId, orderId } = req.params;
    const { reason } = req.body;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
    if (!wholesalerProfile) return res.status(404).json({ success: false, error: 'Wholesaler not found' });

    const order = await prisma.order.findUnique({ where: { id: Number(orderId) } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.wholesalerId !== wholesalerProfile.id) {
      return res.status(403).json({ success: false, error: 'Order does not belong to this wholesaler' });
    }
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ success: false, error: `Cannot reject order with status: ${order.status}` });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: 'rejected', rejectionReason: reason || 'Rejected by admin' } as any
    });

    res.json({ success: true, order: updatedOrder, message: 'Order rejected successfully' });
  } catch (error: any) {
    console.error('Admin Reject Wholesaler Order Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const adminShipWholesalerOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { wId, orderId } = req.params;
    const shipperName = req.body.shipperName || req.body.shipper_name;
    const shipperPhone = req.body.shipperPhone || req.body.shipper_phone;
    const vehiclePlate = req.body.vehiclePlate || req.body.vehicle_plate;
    const delivery_notes = req.body.delivery_notes || req.body.deliveryNotes;
    const tracking_number = req.body.tracking_number || req.body.trackingNumber;

    if (!shipperName || !shipperPhone || !vehiclePlate) {
      return res.status(400).json({ success: false, error: 'Shipper Name, Phone, and Vehicle Plate are required.' });
    }

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
    if (!wholesalerProfile) return res.status(404).json({ success: false, error: 'Wholesaler not found' });

    const order = await prisma.order.findUnique({ where: { id: Number(orderId) } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.wholesalerId !== wholesalerProfile.id) {
      return res.status(403).json({ success: false, error: 'Order does not belong to this wholesaler' });
    }
    if (order.status !== 'confirmed') {
      return res.status(400).json({ success: false, error: `Cannot ship order with status: ${order.status}. Order must be confirmed first.` });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: 'shipped', shipperName, shipperPhone, vehiclePlate } as any
    });

    res.json({ success: true, order: updatedOrder, message: 'Order shipped successfully' });
  } catch (error: any) {
    console.error('Admin Ship Wholesaler Order Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// ADMIN PROXY — WHOLESALER INVENTORY ACTIONS
// ==========================================

export const adminUpdateWholesalerProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { wId, productId } = req.params;
    const { name, category, unit, low_stock_threshold, invoice_number, barcode, description, image } = req.body;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
    if (!wholesalerProfile) return res.status(404).json({ success: false, error: 'Wholesaler not found' });

    const currentProduct = await prisma.product.findUnique({
      where: { id: Number(productId), wholesalerId: wholesalerProfile.id }
    });
    if (!currentProduct) return res.status(404).json({ success: false, error: 'Product not found' });

    let imageUrl = image;
    if (image && image.startsWith('data:image')) {
      const { uploadImage } = await import('../utils/cloudinary');
      imageUrl = await uploadImage(image);
    }

    const product = await prisma.product.update({
      where: { id: Number(productId), wholesalerId: wholesalerProfile.id },
      data: {
        name,
        category,
        unit,
        lowStockThreshold: low_stock_threshold ? parseInt(low_stock_threshold) : undefined,
        invoiceNumber: invoice_number,
        barcode,
        description,
        image: imageUrl,
      } as any
    });

    res.json({ success: true, product });
  } catch (error: any) {
    console.error('Admin Update Wholesaler Product Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const adminUpdateWholesalerStock = async (req: AuthRequest, res: Response) => {
  try {
    const { wId, productId } = req.params;
    const { quantity, type, reason } = req.body;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
    if (!wholesalerProfile) return res.status(404).json({ success: false, error: 'Wholesaler not found' });

    const currentProduct = await prisma.product.findUnique({
      where: { id: Number(productId), wholesalerId: wholesalerProfile.id }
    });
    if (!currentProduct) return res.status(404).json({ success: false, error: 'Product not found' });

    let newStock = currentProduct.stock;
    const amount = parseInt(quantity);
    if (type === 'add') newStock += amount;
    else if (type === 'remove') newStock = Math.max(0, newStock - amount);
    else if (type === 'set') newStock = amount;

    const product = await prisma.product.update({
      where: { id: Number(productId) },
      data: { stock: newStock }
    });

    res.json({ success: true, product });
  } catch (error: any) {
    console.error('Admin Update Wholesaler Stock Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const adminDeleteWholesalerProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { wId, productId } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
    if (!wholesalerProfile) return res.status(404).json({ success: false, error: 'Wholesaler not found' });

    await prisma.product.delete({
      where: { id: Number(productId), wholesalerId: wholesalerProfile.id }
    });

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error: any) {
    console.error('Admin Delete Wholesaler Product Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// WHOLESALER-RETAILER LINKING (ACCOUNT LINKING ENFORCEMENT)
// ==========================================

// Get retailer-wholesaler linkage for admin panel
export const getRetailerWholesalerLinkage = async (req: AuthRequest, res: Response) => {
  try {
    const retailers = await prisma.retailerProfile.findMany({
      include: {
        user: { select: { phone: true, email: true, isActive: true } },
        linkedWholesaler: {
          select: { id: true, companyName: true, user: { select: { phone: true } } }
        }
      }
    });

    const wholesalers = await prisma.wholesalerProfile.findMany({
      include: {
        user: { select: { phone: true, email: true, isActive: true } },
        linkedRetailers: {
          select: { id: true, shopName: true }
        }
      }
    });

    res.json({
      success: true,
      linkage: {
        retailers: retailers.map(r => ({
          id: r.id,
          shopName: r.shopName,
          phone: r.user.phone,
          isActive: r.user.isActive,
          linkedWholesalerId: r.linkedWholesalerId,
          linkedWholesalerName: r.linkedWholesaler?.companyName || null
        })),
        wholesalers: wholesalers.map(w => ({
          id: w.id,
          companyName: w.companyName,
          phone: w.user.phone,
          isActive: w.user.isActive,
          linkedRetailersCount: w.linkedRetailers.length,
          linkedRetailers: w.linkedRetailers
        }))
      }
    });
  } catch (error: any) {
    console.error('Get Retailer-Wholesaler Linkage Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Link retailer to wholesaler (Admin function)
export const linkRetailerToWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { retailerId, wholesalerId } = req.body;

    if (!retailerId || !wholesalerId) {
      return res.status(400).json({ success: false, error: 'Both retailerId and wholesalerId are required' });
    }

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(retailerId) } });
    if (!retailer) {
      return res.status(404).json({ success: false, error: 'Retailer not found' });
    }

    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(wholesalerId) } });
    if (!wholesaler) {
      return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    // Check if retailer is already linked to a different wholesaler
    if (retailer.linkedWholesalerId && retailer.linkedWholesalerId !== Number(wholesalerId)) {
      return res.status(400).json({
        success: false,
        error: 'Retailer is already linked to another wholesaler. Unlink first before linking to a new one.'
      });
    }

    await prisma.retailerProfile.update({
      where: { id: Number(retailerId) },
      data: { linkedWholesalerId: Number(wholesalerId) }
    });

    res.json({ success: true, message: 'Retailer successfully linked to wholesaler' });
  } catch (error: any) {
    console.error('Link Retailer to Wholesaler Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Unlink retailer from wholesaler (Admin function)
export const unlinkRetailerFromWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { retailerId } = req.body;

    if (!retailerId) {
      return res.status(400).json({ success: false, error: 'retailerId is required' });
    }

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(retailerId) } });
    if (!retailer) {
      return res.status(404).json({ success: false, error: 'Retailer not found' });
    }

    await prisma.retailerProfile.update({
      where: { id: Number(retailerId) },
      data: { linkedWholesalerId: null }
    });

    res.json({ success: true, message: 'Retailer successfully unlinked from wholesaler' });
  } catch (error: any) {
    console.error('Unlink Retailer from Wholesaler Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// SETTLEMENT INVOICE MANAGEMENT
// ==========================================

// Get all settlement invoices with filters
export const getSettlementInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const { month, partyType, partyId } = req.query;

    const where: any = {};
    if (month) where.settlementMonth = month as string;
    if (partyType) where.partyType = partyType as string;
    if (partyId) {
      if (partyType === 'retailer') {
        where.retailerId = Number(partyId);
      } else if (partyType === 'wholesaler') {
        where.wholesalerId = Number(partyId);
      }
    }

    const invoices = await prisma.settlementInvoice.findMany({
      where,
      include: {
        retailerProfile: { select: { id: true, shopName: true } },
        wholesalerProfile: { select: { id: true, companyName: true } }
      },
      orderBy: [{ settlementMonth: 'desc' }, { createdAt: 'desc' }]
    });

    const formattedInvoices = invoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      partyType: inv.partyType,
      partyId: inv.partyType === 'retailer' ? inv.retailerId : inv.wholesalerId,
      partyName: inv.partyType === 'retailer'
        ? inv.retailerProfile?.shopName
        : inv.wholesalerProfile?.companyName,
      settlementMonth: inv.settlementMonth,
      totalAmount: inv.totalAmount,
      invoiceFileUrl: inv.invoiceFileUrl,
      notes: inv.notes,
      uploadedBy: inv.uploadedBy,
      uploadedAt: inv.createdAt
    }));

    res.json({ success: true, invoices: formattedInvoices });
  } catch (error: any) {
    console.error('Get Settlement Invoices Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create/upload a settlement invoice
export const createSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { partyType, partyId, settlementMonth, totalAmount, invoiceFileUrl, notes } = req.body;
    const uploadedBy = req.user?.id;

    if (!partyType || !partyId || !settlementMonth || totalAmount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'partyType, partyId, settlementMonth, and totalAmount are required'
      });
    }

    if (partyType !== 'retailer' && partyType !== 'wholesaler') {
      return res.status(400).json({ success: false, error: 'partyType must be "retailer" or "wholesaler"' });
    }

    // Validate party exists
    if (partyType === 'retailer') {
      const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(partyId) } });
      if (!retailer) return res.status(404).json({ success: false, error: 'Retailer not found' });
    } else {
      const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(partyId) } });
      if (!wholesaler) return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    // Generate invoice number
    const count = await prisma.settlementInvoice.count();
    const invoiceNumber = `INV-${settlementMonth}-${(count + 1).toString().padStart(4, '0')}`;

    const invoice = await prisma.settlementInvoice.create({
      data: {
        invoiceNumber,
        partyType,
        retailerId: partyType === 'retailer' ? Number(partyId) : null,
        wholesalerId: partyType === 'wholesaler' ? Number(partyId) : null,
        settlementMonth,
        totalAmount: Number(totalAmount),
        invoiceFileUrl,
        notes,
        uploadedBy: uploadedBy || 0
      },
      include: {
        retailerProfile: { select: { shopName: true } },
        wholesalerProfile: { select: { companyName: true } }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Settlement invoice created successfully',
      invoice: {
        ...invoice,
        partyName: partyType === 'retailer'
          ? invoice.retailerProfile?.shopName
          : invoice.wholesalerProfile?.companyName
      }
    });
  } catch (error: any) {
    console.error('Create Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single settlement invoice
export const getSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const invoice = await prisma.settlementInvoice.findUnique({
      where: { id: Number(id) },
      include: {
        retailerProfile: { select: { id: true, shopName: true, user: { select: { phone: true, email: true } } } },
        wholesalerProfile: { select: { id: true, companyName: true, user: { select: { phone: true, email: true } } } }
      }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    res.json({ success: true, invoice });
  } catch (error: any) {
    console.error('Get Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update settlement invoice
export const updateSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { totalAmount, invoiceFileUrl, notes } = req.body;

    const invoice = await prisma.settlementInvoice.update({
      where: { id: Number(id) },
      data: {
        totalAmount: totalAmount !== undefined ? Number(totalAmount) : undefined,
        invoiceFileUrl,
        notes
      }
    });

    res.json({ success: true, message: 'Invoice updated successfully', invoice });
  } catch (error: any) {
    console.error('Update Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete settlement invoice
export const deleteSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.settlementInvoice.delete({ where: { id: Number(id) } });

    res.json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error: any) {
    console.error('Delete Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// ORDER MANAGMENT (Admin override)
// ==========================================

// Confirm delivery of an order (Admin overriding Wholesaler/Retailer)
export const confirmWholesaleDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: Number(id) }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.status !== 'shipped' && order.status !== 'processing' && order.status !== 'confirmed') {
      return res.status(400).json({ success: false, error: `Cannot confirm delivery for order with status: ${order.status}. Order must be shipped first.` });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update order status
      const updatedOrder = await tx.order.update({
        where: { id: Number(id) },
        data: { status: 'delivered' },
        include: {
          orderItems: { include: { product: true } },
          retailerProfile: true
        }
      });

      // Fetch SystemConfig for Retailer Inheritance Pipeline
      const config = await prisma.systemConfig.findFirst();
      const configAny = config as any;
      const wholesalerMarkupPct = configAny?.wholesalerMarkup || 20;
      const retailerMarkupPct = configAny?.retailerMarkup || 20;
      const exciseDutyRatePct = configAny?.exciseDutyRate || 10;
      const { calculateRetailPrice } = await import('../utils/pricingUtils');

      // 2. Update Retailer's Inventory
      for (const item of updatedOrder.orderItems) {
        if (!item.product) continue;

        // Search for existing product in retailer's inventory
        const existingProduct = await tx.product.findFirst({
          where: {
            retailerId: updatedOrder.retailerId,
            OR: [
              item.product.barcode ? { barcode: item.product.barcode } : { id: -1 },
              item.product.sku ? { sku: item.product.sku } : { id: -1 },
              { name: item.product.name }
            ]
          }
        });

        if (existingProduct) {
          // Update existing stock
          const conversionFactor = (existingProduct as any).conversionFactor ? Number((existingProduct as any).conversionFactor) : null;
          let addStock = item.quantity;
          if (conversionFactor && conversionFactor > 0) {
            addStock = item.quantity * conversionFactor;
          }

          await tx.product.update({
            where: { id: existingProduct.id },
            data: {
              stock: { increment: addStock },
              taxType: item.product.taxType || 'B'
            }
          });
        } else {
          // Create new product for retailer based on wholesaler's product

          // Retailer Inheritance Pipeline
          const prodAny = item.product as any;
          const supplierCost = prodAny.supplierCost || item.product.costPrice || 0;
          const cleanBaseCost = supplierCost * (1 + wholesalerMarkupPct / 100);
          const taxType = prodAny.taxType || 'B';

          const retailPricing = calculateRetailPrice(
            cleanBaseCost,
            retailerMarkupPct,
            taxType,
            exciseDutyRatePct
          );

          const conversionFactor = (item.product as any).conversionFactor ? Number((item.product as any).conversionFactor) : null;
          let addStock = item.quantity;
          if (conversionFactor && conversionFactor > 0) {
            addStock = item.quantity * conversionFactor;
          }

          await tx.product.create({
            data: {
              name: item.product.name,
              description: item.product.description,
              sku: item.product.sku,
              barcode: item.product.barcode,
              category: item.product.category,
              price: retailPricing.finalConsumerShelfPrice, // Module 2 generated Final Consumer Shelf Price
              costPrice: cleanBaseCost,                     // Retailer's cost basis (Taxes stripped out)
              stock: addStock,
              retailerId: updatedOrder.retailerId,
              unit: item.product.unit,
              baseUnit: (item.product as any).baseUnit,
              purchaseUnit: (item.product as any).purchaseUnit,
              conversionFactor: (item.product as any).conversionFactor,
              status: 'active',
              taxType: taxType,
              supplierCost: item.product.price              // The actual invoice amount they paid for the stock
            } as any
          });
        }
      }

      return updatedOrder;
    }, { timeout: 15000 });

    res.json({ success: true, order: result, message: 'Delivery confirmed and retailer stock updated by Admin' });
  } catch (error: any) {
    console.error('Error confirming delivery by Admin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get system email logs for monitoring
 */
export const getEmailLogs = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, status, channel, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (search) {
      where.OR = [
        { recipientEmail: { contains: search as string } },
        { recipientPhone: { contains: search as string } },
        { templateType: { contains: search as string } },
        { relatedEntityId: { contains: search as string } },
        // @ts-ignore
        { subject: { contains: search as string } }
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.systemEmailLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: Number(limit),
        skip: skip
      }),
      prisma.systemEmailLog.count({ where })
    ]);

    res.json({
      success: true,
      logs,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit))
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Resend a failed email manually from logs
 */
export const resendEmail = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const log = await prisma.systemEmailLog.findUnique({
      where: { id: Number(id) }
    });

    if (!log) {
      return res.status(404).json({ success: false, error: 'Email log not found' });
    }

    // Add back to queue (Requirement 4.2.9)
    await emailQueue.add('manual-resend', {
      to: log.recipientEmail,
      // @ts-ignore
      subject: log.subject,
      templateType: log.templateType,
      logId: log.id,
    });

    res.json({ success: true, message: 'Email has been queued for resending' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all email templates
 */
export const getEmailTemplates = async (req: AuthRequest, res: Response) => {
  try {
    // @ts-ignore
    const templates = await prisma.emailTemplate.findMany({
      orderBy: { name: 'asc' }
    });
    res.json({ success: true, templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Create or Update an email template with validation
 */
export const saveEmailTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { name, subject, content, description, isActive, portal, triggerName, channel } = req.body;

    const SUPPORTED_VARIABLES = [
      'Customer_name', 'customer_name', 'name', 'retail_name', 'wholesaler_name',
      'meter_name', 'meter_id', 'amount', 'volume', 'token', 'transaction_id',
      'tempPass', 'role', 'email', 'productName', 'currentStock', 'threshold',
      'type', 'balance', 'txRef', 'orderNumber', 'quantity', 'totalAmount',
      'temp_password', 'attempt_time', 'date', 'month', 'salesCount', 'revenue',
      'newRetailers', 'newWholesalers', 'lowStockCount', 'offlineMeters', 'period',
      'action', 'reason'
    ];

    // Validate variables in both subject and content
    const textToValidate = `${subject || ''} ${content || ''}`;
    const variableRegex = /{{(.*?)}}/g;
    const invalidVariables = [];
    let match;
    while ((match = variableRegex.exec(textToValidate)) !== null) {
      const varName = match[1].trim();
      if (!SUPPORTED_VARIABLES.includes(varName)) {
        invalidVariables.push(varName);
      }
    }

    if (invalidVariables.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid or unsupported variable(s): ${invalidVariables.map(v => `{{${v}}}`).join(', ')}. Please use only valid system variables.`
      });
    }

    // @ts-ignore
    const template = await prisma.emailTemplate.upsert({
      where: { name },
      update: { subject, content, description, isActive, portal, triggerName, channel },
      create: { name, subject, content, description, isActive, portal, triggerName, channel }
    });

    // Auto-map event slug if triggerName is provided to ensure delivery/trigger
    if (triggerName) {
      const eventSlug = triggerName.trim();
      // @ts-ignore
      await prisma.emailEvent.upsert({
        where: { eventSlug },
        update: { templateName: name, description: `Auto-mapped event for template ${name}` },
        create: { eventSlug, templateName: name, description: `Auto-mapped event for template ${name}` }
      });
    }

    res.json({ success: true, template, message: 'Template saved successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Preview email or SMS template with mockup data
 */
export const previewEmailTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { subject, content, channel } = req.body;

    const mockData = {
      Customer_name: 'Kayitare',
      customer_name: 'Kayitare',
      name: 'Kayitare',
      retail_name: 'Apex Retailer',
      wholesaler_name: 'Apex Wholesaler',
      meter_name: 'Tekana Gas Meter',
      meter_id: '2510170000331',
      amount: '650',
      volume: '0.1',
      token: '67444670080112715377',
      transaction_id: '170',
      tempPass: 'tempPass123',
      role: 'retailer',
      email: 'customer@gmail.com',
      productName: 'Cooking Gas Regulator',
      currentStock: '5',
      threshold: '10',
      type: 'LOW_BALANCE',
      balance: '1200',
      txRef: 'REF-8273648',
      orderNumber: 'ORD-9923',
      quantity: '3',
      totalAmount: '9750',
      temp_password: 'ResetTempPass123',
      attempt_time: new Date().toLocaleString(),
      date: new Date().toLocaleDateString(),
      month: 'July',
      salesCount: 42,
      revenue: 136500,
      newRetailers: 4,
      newWholesalers: 1,
      lowStockCount: 2,
      offlineMeters: 0,
      period: 'Today',
      action: 'SUSPENDED',
      reason: 'Policy Violation'
    };

    const render = (template: string, data: Record<string, any>): string => {
      let rendered = template;
      Object.keys(data).forEach(key => {
        const value = data[key];
        const regex = new RegExp(`{{${key}}}`, 'g');
        rendered = rendered.replace(regex, value !== undefined && value !== null ? String(value) : '');
      });
      return rendered;
    };

    const renderedSubject = render(subject || '', mockData);
    let renderedContent = render(content || '', mockData);

    const isSMS = channel === 'SMS';
    if (!isSMS) {
      renderedContent = TemplateService.wrap(renderedContent);
    }

    res.json({
      success: true,
      data: {
        subject: renderedSubject,
        content: renderedContent,
        isSMS
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all supported variables for email/SMS templates
 */
export const getTemplateVariables = async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      variables: [
        'Customer_name', 'customer_name', 'name', 'retail_name', 'wholesaler_name',
        'meter_name', 'meter_id', 'amount', 'volume', 'token', 'transaction_id',
        'tempPass', 'role', 'email', 'productName', 'currentStock', 'threshold',
        'type', 'balance', 'txRef', 'orderNumber', 'quantity', 'totalAmount',
        'temp_password', 'attempt_time', 'date', 'month', 'salesCount', 'revenue',
        'newRetailers', 'newWholesalers', 'lowStockCount', 'offlineMeters', 'period',
        'action', 'reason'
      ]
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Delete an email template
 */
export const deleteEmailTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    // @ts-ignore
    await prisma.emailTemplate.delete({
      where: { id: Number(id) }
    });
    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Send manual email/announcement to selected users
 */
export const sendManualEmail = async (req: AuthRequest, res: Response) => {
  try {
    const { recipients, groups, subject, html, category } = req.body;

    let targetRecipients: string[] = Array.isArray(recipients) ? [...recipients] : [];

    if (groups && Array.isArray(groups) && groups.length > 0) {
      const roleMap: Record<string, string> = {
        'Customers': 'consumer',
        'Retailers': 'retailer',
        'Wholesalers': 'wholesaler',
        'customers': 'consumer',
        'retailers': 'retailer',
        'wholesalers': 'wholesaler'
      };

      const rolesToQuery = groups.map(g => roleMap[g] || g.toLowerCase());

      const groupUsers = await prisma.user.findMany({
        where: {
          role: { in: rolesToQuery as any },
          isActive: true,
          email: { not: null }
        },
        select: { email: true }
      });

      const groupEmails = groupUsers.map(u => u.email!).filter(e => e && e.trim() !== '');
      targetRecipients = Array.from(new Set([...targetRecipients, ...groupEmails]));
    }

    if (targetRecipients.length === 0) {
      return res.status(400).json({ success: false, error: 'No recipients resolved' });
    }

    // Query names for recipients to dynamically replace placeholders
    const users = await prisma.user.findMany({
      where: { email: { in: targetRecipients } }
    });
    const userMap = new Map(users.map(u => [u.email?.toLowerCase(), u]));


    // Add each to queue (Requirement 4.2.10)
    const jobs = targetRecipients.map(email => {
      const u = userMap.get(email.toLowerCase());
      const name = u?.name || 'Valued Customer';

      const namePlaceholderRegex = /{{(customer_name|retail_name|wholesaler_name|name)}}/g;
      const finalHtml = html.replace(namePlaceholderRegex, name);
      const finalSubject = subject.replace(namePlaceholderRegex, name);

      return {
        name: 'manual-announcement',
        data: {
          to: email,
          subject: finalSubject,
          html: finalHtml,
          templateType: category || 'ANNOUNCEMENT'
        }
      };
    });

    await emailQueue.addBulk(jobs);

    res.json({ success: true, message: `Queued ${targetRecipients.length} emails successfully` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all email event mappings
 */
export const getEmailEvents = async (req: AuthRequest, res: Response) => {
  try {
    // @ts-ignore
    const events = await prisma.emailEvent.findMany({
      orderBy: { eventSlug: 'asc' }
    });
    res.json({ success: true, events });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update an email event mapping
 */
export const updateEmailEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { templateName, description } = req.body;

    if (templateName) {
      // Fetch the template to check its target portal
      // @ts-ignore
      const template = await prisma.emailTemplate.findUnique({
        where: { name: templateName }
      });

      if (!template) {
        return res.status(404).json({ success: false, error: `Template '${templateName}' not found` });
      }

      // Fetch the event to get its slug
      // @ts-ignore
      const event = await prisma.emailEvent.findUnique({
        where: { id: Number(id) }
      });

      if (!event) {
        return res.status(404).json({ success: false, error: 'Event mapping not found' });
      }

      const eventSlug = event.eventSlug.toLowerCase();
      let eventPortal = 'SHARED';
      if (eventSlug.startsWith('wholesaler-') || eventSlug.startsWith('who-')) {
        eventPortal = 'WHOLESALER';
      } else if (eventSlug.startsWith('customer-') || eventSlug.startsWith('cus-')) {
        eventPortal = 'CUSTOMER';
      } else if (eventSlug.startsWith('retailer-') || eventSlug.startsWith('ret-')) {
        eventPortal = 'RETAILER';
      }

      const templatePortal = (template.portal || 'CUSTOMER').toUpperCase();
      const isSharedTemplate = ['SHARED', 'ALL', 'MULTIPLE/ALL', 'MULTIPLE', 'SYSTEM'].includes(templatePortal);

      if (!isSharedTemplate && templatePortal !== eventPortal) {
        const friendlyTemplatePortal = template.portal.toLowerCase();
        const friendlyEventPortal = eventPortal === 'SHARED' ? 'general/shared' : `${eventPortal.toLowerCase()}-specific`;
        return res.status(400).json({
          success: false,
          error: `Audience Mismatch: The selected template is designed for ${friendlyTemplatePortal}s, but this system event is for ${friendlyEventPortal} communications. Please select a template matching the target audience.`
        });
      }
    }

    // @ts-ignore
    const event = await prisma.emailEvent.update({
      where: { id: Number(id) },
      data: { templateName, description }
    });

    res.json({ success: true, event, message: 'Event mapping updated successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// SYSTEM ALERTS
// ==========================================

export const getSystemAlerts = async (req: AuthRequest, res: Response) => {
  try {
    const alerts = await prisma.systemAlert.findMany({
      orderBy: { failureTime: 'desc' }
    });
    res.json({ success: true, alerts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const acknowledgeAlert = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const alert = await prisma.systemAlert.update({
      where: { id: Number(id) },
      data: {
        status: 'resolved',
        resolvedTime: new Date()
      }
    });
    res.json({ success: true, alert, message: 'Alert acknowledged successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateCustomerCreditLimit = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // ConsumerProfile ID
    const { creditLimit } = req.body;

    if (creditLimit === undefined || isNaN(parseFloat(creditLimit)) || parseFloat(creditLimit) < 0) {
      return res.status(400).json({ success: false, error: 'Invalid credit limit amount' });
    }

    const profile = await prisma.consumerProfile.update({
      where: { id: Number(id) },
      data: { creditLimit: parseFloat(creditLimit) } as any
    });

    res.json({ success: true, profile, message: 'Customer credit limit updated successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCustomerCreditLimit = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // ConsumerProfile ID
    const profile = await prisma.consumerProfile.findUnique({
      where: { id: Number(id) },
      include: { user: { select: { name: true, email: true, phone: true } } }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Customer profile not found' });
    }

    res.json({ success: true, creditLimit: (profile as any).creditLimit || 50000, profile });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Refund Requests
export const getRefundRequests = async (req: AuthRequest, res: Response) => {
  try {
    const refundRequests = await prisma.walletTransaction.findMany({
      where: {
        type: 'refund'
      },
      include: {
        wallet: {
          include: {
            consumerProfile: {
              include: { user: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: refundRequests });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const processRefundRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: Number(id) },
      include: { wallet: { include: { consumerProfile: { include: { user: true } } } } }
    });

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Refund request not found' });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request is already processed' });
    }

    await prisma.$transaction(async (tx) => {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      // Update transaction status
      await tx.walletTransaction.update({
        where: { id: transaction.id },
        data: {
          status: newStatus,
          description: reason ? `${transaction.description} - ${reason}` : transaction.description
        }
      });

      // If approved, deduct from wallet
      if (action === 'approve' && transaction.walletId) {
        const currentWallet = await tx.wallet.findUnique({
          where: { id: transaction.walletId }
        });

        if (currentWallet && currentWallet.balance < transaction.amount) {
          throw new Error('Customer wallet has insufficient balance for this refund');
        }

        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: {
            balance: { decrement: transaction.amount }
          }
        });

        if (transaction.wallet && transaction.wallet.consumerId) {
          const profileWalletCount = await tx.wallet.findFirst({
            where: { id: transaction.walletId, type: 'dashboard_wallet' }
          });
          if (profileWalletCount) {
            await tx.consumerProfile.update({
              where: { id: transaction.wallet.consumerId },
              data: { walletBalance: { decrement: transaction.amount } }
            });
          }
        }
      }
    });

    // Trigger Customer Refund Notification (CUS-EMAIL-009)
    try {
      if (transaction.wallet?.consumerProfile?.user?.email) {
        const { emailQueue } = await import('../queues/email.queue');
        await emailQueue.add('customer-refund-request-email', {
          to: transaction.wallet.consumerProfile.user.email,
          templateType: 'customer-refund-request-email', // Mapped to CUS-EMAIL-009
          data: {
            customer_name: transaction.wallet.consumerProfile.fullName || transaction.wallet.consumerProfile.user.name || 'Customer',
            amount: transaction.amount.toLocaleString(),
            status: action === 'approve' ? 'Approved & Refunded' : 'Rejected',
            date: new Date().toLocaleDateString()
          },
          relatedEntity: { type: 'WALLET_TRANSACTION', id: transaction.id.toString() }
        });
      }
    } catch (err) {
      console.error('Customer refund notification failed:', err);
    }

    res.json({ success: true, message: `Refund request ${action}d successfully` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// PROFIT INVOICES (Admin)
// ==========================================
export const getAdminProfitInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await prisma.customProfitInvoice.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: invoices });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const generateAdminProfitInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const {
      recipientType,
      recipientId,
      recipientName,
      totalOrders,
      totalRevenue,
      grossProfit,
      tax,
      netProfit,
      recipientSharePct,
      recipientShareAmt,
      companySharePct,
      companyShareAmt,
      rewardsPoolPct,
      rewardsPoolAmt,
      rewardsGivenAmt,
      rentExpense,
      salariesExpense,
      otherExpense,
      totalExpense,
      finalPayable
    } = req.body;

    if (!recipientType || !recipientId) {
      return res.status(400).json({ success: false, error: 'Recipient Type and ID are required' });
    }

    const data: any = {
      recipientType,
      recipientName,
      totalOrders: Number(totalOrders) || 0,
      totalRevenue: Number(totalRevenue) || 0,
      grossProfit: Number(grossProfit) || 0,
      tax: Number(tax) || 0,
      netProfit: Number(netProfit) || 0,
      recipientSharePct: Number(recipientSharePct) || 0,
      recipientShareAmt: Number(recipientShareAmt) || 0,
      companySharePct: Number(companySharePct) || 0,
      companyShareAmt: Number(companyShareAmt) || 0,
      rewardsPoolPct: Number(rewardsPoolPct) || 0,
      rewardsPoolAmt: Number(rewardsPoolAmt) || 0,
      rewardsGivenAmt: Number(rewardsGivenAmt) || 0,
      rentExpense: Number(rentExpense) || 0,
      salariesExpense: Number(salariesExpense) || 0,
      otherExpense: Number(otherExpense) || 0,
      totalExpense: Number(totalExpense) || 0,
      finalPayable: Number(finalPayable) || 0
    };

    if (recipientType === 'Retailer') {
      data.retailerId = Number(recipientId);
    } else {
      data.wholesalerId = Number(recipientId);
    }

    const newInvoice = await prisma.$transaction(async (tx) => {
      const invoice = await tx.customProfitInvoice.create({ data });

      // Reset stats (by updating lastSettlementDate)
      const now = new Date();
      if (recipientType === 'Retailer') {
        await tx.retailerProfile.update({
          where: { id: Number(recipientId) },
          data: { lastSettlementDate: now }
        });

        // Log global reset alert for Admin Customer Management dashboard (Total Orders & Total Revenue)
        await tx.systemAlert.create({
          data: {
            apiName: 'RETAILER_PROFIT_INVOICE_RESET',
            status: 'resolved',
            errorMessage: now.toISOString()
          }
        });
      } else {
        await tx.wholesalerProfile.update({
          where: { id: Number(recipientId) },
          data: { lastSettlementDate: now }
        });
      }

      return invoice;
    });

    res.json({ success: true, message: 'Profit invoice generated successfully', data: newInvoice });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getProfitInvoiceRecipients = async (req: AuthRequest, res: Response) => {
  try {
    const retailers = await prisma.retailerProfile.findMany({
      where: { isVerified: true },
      select: { id: true, shopName: true }
    });

    const wholesalers = await prisma.wholesalerProfile.findMany({
      where: { isVerified: true },
      select: { id: true, companyName: true }
    });

    const formattedRetailers = retailers.map(r => ({ id: r.id, name: r.shopName, type: 'Retailer' }));
    const formattedWholesalers = wholesalers.map(w => ({ id: w.id, name: w.companyName, type: 'Wholesaler' }));

    res.json({ success: true, data: [...formattedRetailers, ...formattedWholesalers] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getProfitInvoiceStats = async (req: AuthRequest, res: Response) => {
  try {
    const { type, id } = req.params;
    let totalRevenue = 0;
    let totalCost = 0;
    let gasRewardsGiven = 0;

    if (type === 'Retailer') {
      const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
      if (!retailer) return res.status(404).json({ success: false, error: 'Retailer not found' });

      const dateFilter = retailer.lastSettlementDate ? { gte: retailer.lastSettlementDate } : undefined;

      const sales = await prisma.sale.findMany({
        where: {
          retailerId: Number(id),
          status: { not: 'cancelled' },
          ...(dateFilter ? { createdAt: dateFilter } : {})
        },
        include: { saleItems: { include: { product: true } } }
      });

      const systemConfig = await prisma.systemConfig.findFirst();
      const retailerMarkup = systemConfig?.retailerMarkup || 20;

      for (const sale of sales) {
        for (const item of sale.saleItems) {
          totalRevenue += (item.price * item.quantity);
          const cost = item.product.costPrice && item.product.costPrice > 0
            ? item.product.costPrice
            : item.price / (1 + retailerMarkup / 100);
          totalCost += (cost * item.quantity);
        }
      }

      const [rewards] = await Promise.all([
        prisma.gasReward.aggregate({
          where: {
            sale: { retailerId: Number(id) },
            ...(dateFilter ? { createdAt: dateFilter } : {})
          },
          _sum: { units: true }
        })
      ]);

      const gasUnits = rewards._sum.units || 0;
      const gasPrice = systemConfig?.gasPricePerM3 || 6500;
      gasRewardsGiven = Math.round(gasUnits * gasPrice);

      res.json({
        success: true,
        data: {
          totalOrders: sales.length,
          totalRevenue,
          grossProfit: totalRevenue - totalCost,
          gasRewardsGiven
        }
      });

    } else if (type === 'Wholesaler') {
      const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
      if (!wholesaler) return res.status(404).json({ success: false, error: 'Wholesaler not found' });

      const dateFilter = wholesaler.lastSettlementDate ? { gte: wholesaler.lastSettlementDate } : undefined;

      const orders = await prisma.order.findMany({
        where: {
          wholesalerId: Number(id),
          status: { in: ['delivered', 'completed'] },
          ...(dateFilter ? { createdAt: dateFilter } : {})
        },
        include: { orderItems: { include: { product: true } } }
      });

      for (const order of orders) {
        for (const item of order.orderItems) {
          totalRevenue += (item.price * item.quantity);
          const cost = item.product.supplierCost !== null && item.product.supplierCost !== undefined && item.product.supplierCost > 0
            ? item.product.supplierCost
            : (item.product.costPrice || 0);
          totalCost += (cost * item.quantity);
        }
      }

      res.json({
        success: true,
        data: {
          totalOrders: orders.length,
          totalRevenue,
          grossProfit: totalRevenue - totalCost,
          gasRewardsGiven: 0
        }
      });
    } else {
      res.status(400).json({ success: false, error: 'Invalid type' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// End the month or term globally for gas reporting
export const endGasPeriod = async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    await prisma.systemAlert.create({
      data: {
        apiName: 'GAS_REPORTING_PERIOD_RESET',
        status: 'resolved',
        errorMessage: now.toISOString()
      }
    });

    // Reset remaining units on all meters to zero
    await prisma.gasMeter.updateMany({
      data: {
        currentUnits: 0
      }
    });

    res.json({ success: true, message: 'Gas reporting period ended successfully' });
  } catch (error: any) {
    console.error('End Gas Period Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
