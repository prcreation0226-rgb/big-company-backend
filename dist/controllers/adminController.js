"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminConfirmWholesalerOrder = exports.getWholesalerAccountDetails = exports.getWorkerAccountDetails = exports.getRetailerAccountDetails = exports.getCustomerAccountDetails = exports.updateSystemConfig = exports.getSystemConfig = exports.getRevenueReport = exports.getTransactionReport = exports.unlinkNFCCard = exports.activateNFCCard = exports.blockNFCCard = exports.getNFCCardTransactions = exports.registerNFCCard = exports.rejectLoan = exports.approveLoan = exports.deleteEmployee = exports.updateEmployee = exports.createEmployee = exports.getEmployees = exports.deleteProduct = exports.updateProduct = exports.createProduct = exports.getProducts = exports.deleteCustomer = exports.updateCustomerStatus = exports.updateCustomer = exports.updateWholesalerStatus = exports.updateRetailerStatus = exports.deleteWholesaler = exports.updateWholesaler = exports.verifyWholesaler = exports.verifyRetailer = exports.deleteRetailer = exports.updateRetailer = exports.deleteCategory = exports.updateCategory = exports.createCategory = exports.getCategories = exports.getNFCCards = exports.getLoans = exports.createWholesaler = exports.getWholesalers = exports.createRetailer = exports.getRetailers = exports.createCustomer = exports.getCustomer = exports.getCustomers = exports.getReports = exports.getDashboard = void 0;
exports.endGasPeriod = exports.getProfitInvoiceStats = exports.getProfitInvoiceRecipients = exports.generateAdminProfitInvoice = exports.getAdminProfitInvoices = exports.processRefundRequest = exports.getRefundRequests = exports.getCustomerCreditLimit = exports.updateCustomerCreditLimit = exports.acknowledgeAlert = exports.getSystemAlerts = exports.updateEmailEvent = exports.getEmailEvents = exports.sendManualEmail = exports.deleteEmailTemplate = exports.saveEmailTemplate = exports.getEmailTemplates = exports.resendEmail = exports.getEmailLogs = exports.confirmWholesaleDelivery = exports.deleteSettlementInvoice = exports.updateSettlementInvoice = exports.getSettlementInvoice = exports.createSettlementInvoice = exports.getSettlementInvoices = exports.unlinkRetailerFromWholesaler = exports.linkRetailerToWholesaler = exports.getRetailerWholesalerLinkage = exports.adminDeleteWholesalerProduct = exports.adminUpdateWholesalerStock = exports.adminUpdateWholesalerProduct = exports.adminShipWholesalerOrder = exports.adminRejectWholesalerOrder = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const cloudinary_1 = require("../utils/cloudinary");
const auth_1 = require("../utils/auth");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const email_queue_1 = require("../queues/email.queue");
const email_validator_1 = require("../utils/email-validator");
const pricingUtils_1 = require("../utils/pricingUtils");
// Get detailed dashboard stats.
const getDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        // Fix dates math bug (avoid modifying now object in place)
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        // Retrieve latest Reset date
        const resetAlert = yield prisma_1.default.systemAlert.findFirst({
            where: { apiName: 'GAS_REPORTING_PERIOD_RESET' },
            orderBy: { createdAt: 'desc' }
        });
        const lastGasResetDate = resetAlert ? new Date(resetAlert.errorMessage) : null;
        // 1. Customers
        const customerTotal = yield prisma_1.default.consumerProfile.count();
        const customerLast24h = yield prisma_1.default.consumerProfile.count({ where: { user: { createdAt: { gte: last24h } } } });
        const customerLast7d = yield prisma_1.default.consumerProfile.count({ where: { user: { createdAt: { gte: last7d } } } });
        const customerLast30d = yield prisma_1.default.consumerProfile.count({ where: { user: { createdAt: { gte: last30d } } } });
        // Retrieve latest Retailer Profit Invoice Reset date (for Orders and Revenue)
        const profitResetAlert = yield prisma_1.default.systemAlert.findFirst({
            where: { apiName: 'RETAILER_PROFIT_INVOICE_RESET' },
            orderBy: { createdAt: 'desc' }
        });
        const lastProfitResetDate = profitResetAlert ? new Date(profitResetAlert.errorMessage) : null;
        // 2. Orders & Revenue (Combine B2C Sales and B2B Wholesaler Orders)
        const [sales, wholesaleOrders] = yield Promise.all([
            prisma_1.default.sale.findMany({
                where: Object.assign(Object.assign({}, (lastProfitResetDate ? { createdAt: { gte: lastProfitResetDate } } : {})), { saleItems: { some: {} }, NOT: {
                        saleItems: {
                            some: {
                                product: { category: { in: ['Gas', 'gas', 'GAS'] } }
                            }
                        }
                    } }),
                include: { saleItems: true }
            }),
            prisma_1.default.order.findMany({
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
                const settlementDate = (_a = order.wholesalerProfile) === null || _a === void 0 ? void 0 : _a.lastSettlementDate;
                if (!settlementDate || order.createdAt >= settlementDate) {
                    wholesaleRevenue += order.totalAmount;
                }
            }
        }
        const totalRevenue = Math.round(salesRevenue + wholesaleRevenue);
        // Only count active/real orders (exclude cancelled) for today's orders
        const todayOrders = sales.filter(s => s.createdAt >= todayStart && s.status !== 'cancelled').length + wholesaleOrders.filter(o => o.createdAt >= todayStart && o.status !== 'cancelled').length;
        // 3. Transactions (using WalletTransaction)
        const txs = yield prisma_1.default.walletTransaction.findMany({ where: { createdAt: { gte: last30d } } });
        const txTotal = yield prisma_1.default.walletTransaction.count();
        const walletTopups = txs.filter(t => t.type === 'top_up').length;
        const gasPurchases = txs.filter(t => t.type === 'gas_payment' || t.type === 'gas_purchase').length;
        const nfcPayments = sales.filter(s => s.paymentMethod === 'nfc' && s.createdAt >= last30d).length;
        const totalVolume = Math.round(txs
            .filter(t => lastGasResetDate ? t.createdAt >= lastGasResetDate : true)
            .reduce((acc, t) => acc + Math.abs(t.amount), 0));
        // 4. Loans (Include both customer loans and retailer credit loans)
        const loans = yield prisma_1.default.loan.findMany();
        const retailerCredits = yield prisma_1.default.retailerCredit.findMany();
        const loanTotal = loans.length + retailerCredits.length;
        const loanPending = loans.filter(l => l.status === 'pending').length;
        // Active loans = customer active loans + retailers with outstanding credit balance
        const loanActive = loans.filter(l => l.status === 'active' || l.status === 'approved').length + retailerCredits.filter(r => r.usedCredit > 0).length;
        const loanPaid = loans.filter(l => l.status === 'paid' || l.status === 'repaid').length + retailerCredits.filter(r => r.usedCredit === 0).length;
        const loanDefaulted = loans.filter(l => l.status === 'defaulted' || l.status === 'overdue').length;
        // Calculate actual outstanding balances (principal - repayments) + retailer outstanding credit balances
        const customerLoanRepayments = yield prisma_1.default.walletTransaction.findMany({
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
        const gasTopups = yield prisma_1.default.gasTopup.findMany({
            where: Object.assign({ status: { in: ['completed', 'success'] } }, (lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {}))
        });
        const gasTotalPurchases = gasTopups.length;
        const gasTotalAmount = Math.round(gasTopups.reduce((acc, g) => acc + g.amount, 0));
        const gasTotalUnits = gasTopups.reduce((acc, g) => acc + g.units, 0);
        // 6. NFC Cards
        const nfcTotal = yield prisma_1.default.nfcCard.count();
        const nfcActive = yield prisma_1.default.nfcCard.count({ where: { status: 'active' } });
        const nfcLinked = yield prisma_1.default.nfcCard.count({ where: { consumerId: { not: null } } });
        // 7. Retailers & Wholesalers
        const retailerTotal = yield prisma_1.default.retailerProfile.count();
        const retailerActive = yield prisma_1.default.retailerProfile.count({ where: { user: { isActive: true } } });
        const retailerVerified = yield prisma_1.default.retailerProfile.count({ where: { isVerified: true } });
        const wholesalerTotal = yield prisma_1.default.wholesalerProfile.count();
        const wholesalerActive = yield prisma_1.default.wholesalerProfile.count({ where: { user: { isActive: true } } });
        // 8. System-wide Wallets (Consumer dashboard & Retailer capital wallets)
        const consumerWalletSum = yield prisma_1.default.wallet.aggregate({
            where: { type: 'dashboard_wallet' },
            _sum: { balance: true }
        });
        const secondaryWalletsSum = yield prisma_1.default.wallet.aggregate({
            where: { type: 'capital' },
            _sum: { balance: true }
        });
        const totalWalletBalance = Math.round((consumerWalletSum._sum.balance || 0) +
            (secondaryWalletsSum._sum.balance || 0));
        // 9. System-wide Rewards (Sum of all historically distributed gas rewards)
        const gasRewardsSum = yield prisma_1.default.gasReward.aggregate({ _sum: { units: true } });
        const totalRewardsPoints = Math.round(gasRewardsSum._sum.units || 0);
        // 10. System-wide Inventory (Stock & evaluated cost value)
        const allProducts = yield prisma_1.default.product.findMany();
        const totalProductsCount = allProducts.length;
        const totalInventoryValue = Math.round(allProducts.reduce((sum, p) => {
            if (p.retailerId !== null) {
                return sum + (p.stock * (p.costPrice || 0));
            }
            if (p.wholesalerId !== null) {
                const cost = p.supplierCost !== null && p.supplierCost !== undefined && p.supplierCost > 0 ? p.supplierCost : (p.costPrice || 0);
                return sum + (p.stock * cost);
            }
            return sum;
        }, 0));
        // Recent Activity - Merge Sales, New Customers, Loans, and Gas Topups
        const [recentSales, recentConsumers, recentLoans, recentGas] = yield Promise.all([
            prisma_1.default.sale.findMany({
                take: 5,
                orderBy: { createdAt: 'desc' },
                where: { saleItems: { some: {} } },
                include: {
                    consumerProfile: { select: { fullName: true } }
                }
            }),
            prisma_1.default.consumerProfile.findMany({
                take: 5,
                orderBy: { user: { createdAt: 'desc' } },
                include: { user: true }
            }),
            prisma_1.default.loan.findMany({
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: { consumerProfile: true }
            }),
            prisma_1.default.gasTopup.findMany({
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: { consumerProfile: { select: { fullName: true } } }
            })
        ]);
        const activities = [
            ...recentSales.map(s => {
                var _a;
                return ({
                    id: `sale-${s.id}`,
                    action: 'order_placed',
                    entity_type: 'order',
                    description: `Order of ${Math.round(s.totalAmount)} RWF by ${((_a = s.consumerProfile) === null || _a === void 0 ? void 0 : _a.fullName) || 'Customer'}`,
                    created_at: s.createdAt
                });
            }),
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
            ...recentGas.map(g => {
                var _a;
                return ({
                    id: `gas-${g.id}`,
                    action: 'gas_recharge',
                    entity_type: 'gas',
                    description: `${Math.round(g.amount)} RWF recharge for ${((_a = g.consumerProfile) === null || _a === void 0 ? void 0 : _a.fullName) || 'Customer'}`,
                    created_at: g.createdAt
                });
            })
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
    }
    catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.getDashboard = getDashboard;
const getReports = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { dateRange } = req.query;
        const now = new Date();
        let startDate = new Date(0); // All time default
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        if (dateRange === 'today') {
            startDate = todayStart;
        }
        else if (dateRange === '7days') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
        else if (dateRange === '30days') {
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        else if (dateRange === 'year') {
            startDate = new Date(now.getFullYear(), 0, 1);
        }
        // 1. Stats based on date range
        const [sales, wholesaleOrders, gasTopups] = yield Promise.all([
            prisma_1.default.sale.findMany({
                where: {
                    createdAt: { gte: startDate },
                    saleItems: { some: {} }
                }
            }),
            prisma_1.default.order.findMany({ where: { createdAt: { gte: startDate } } }),
            prisma_1.default.gasTopup.findMany({ where: { createdAt: { gte: startDate }, status: { in: ['completed', 'success'] } } })
        ]);
        const salesRevenue = sales.filter(s => s.status === 'completed' || s.status === 'delivered').reduce((acc, s) => acc + s.totalAmount, 0);
        const wholesaleRevenue = wholesaleOrders.filter(o => o.status === 'delivered').reduce((acc, o) => acc + o.totalAmount, 0);
        const totalRevenue = Math.round(salesRevenue + wholesaleRevenue);
        const orderTotal = sales.filter(s => s.status !== 'cancelled').length + wholesaleOrders.filter(o => o.status !== 'cancelled').length;
        const gasDistributed = gasTopups.reduce((acc, g) => acc + g.units, 0);
        // 2. Global counts
        const [retailerTotal, wholesalerTotal, productTotal, customerTotal, loans, retailerCredits] = yield Promise.all([
            prisma_1.default.retailerProfile.count(),
            prisma_1.default.wholesalerProfile.count(),
            prisma_1.default.product.count(),
            prisma_1.default.consumerProfile.count(),
            prisma_1.default.loan.findMany(),
            prisma_1.default.retailerCredit.findMany()
        ]);
        const activeLoans = loans.filter(l => l.status === 'active' || l.status === 'approved').length + retailerCredits.filter(r => r.usedCredit > 0).length;
        const pendingLoans = loans.filter(l => l.status === 'pending').length;
        const customerLoanRepayments = yield prisma_1.default.walletTransaction.findMany({
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
        const [prevSales, prevWholesale] = yield Promise.all([
            prisma_1.default.sale.findMany({
                where: {
                    createdAt: {
                        gte: prevPeriodStart,
                        lt: startDate
                    },
                    saleItems: { some: {} }
                }
            }),
            prisma_1.default.order.findMany({
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
        const dailySalesMap = {};
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
        const saleItems = yield prisma_1.default.saleItem.findMany({
            where: { sale: { status: { in: ['completed', 'delivered'] } } },
            include: { product: true }
        });
        const productSalesMap = {};
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
        const retailers = yield prisma_1.default.retailerProfile.findMany({
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
    }
    catch (error) {
        console.error('Get Reports Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getReports = getReports;
// Get customers
const getCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const customers = yield prisma_1.default.consumerProfile.findMany({
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
        const retailerProfiles = yield prisma_1.default.retailerProfile.findMany();
        const retailerMap = new Map(retailerProfiles.map(rp => [rp.id, rp]));
        const formattedCustomers = customers.map(customer => {
            const activeSales = customer.sales.filter(sale => {
                // Exclude gas top-up purchases (which have no saleItems)
                if (!sale.saleItems || sale.saleItems.length === 0) {
                    return false;
                }
                // Exclude sales before the retailer's lastSettlementDate
                const retailer = retailerMap.get(sale.retailerId);
                const settlementDate = retailer === null || retailer === void 0 ? void 0 : retailer.lastSettlementDate;
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
            return Object.assign(Object.assign({}, customer), { walletBalance,
                rewardsPoints,
                orderCount,
                totalSpent,
                gasBalance });
        });
        res.json({ success: true, customers: formattedCustomers });
    }
    catch (error) {
        console.error('Get Customers Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getCustomers = getCustomers;
const getCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const customer = yield prisma_1.default.consumerProfile.findUnique({
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
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getCustomer = getCustomer;
// Create customer (Admin only)
const createCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const existingUser = yield prisma_1.default.user.findFirst({
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
        const hashedPassword = password ? yield (0, auth_1.hashPassword)(password) : undefined;
        const hashedPin = pin ? yield (0, auth_1.hashPassword)(pin) : undefined;
        // Create user and profile in transaction
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Construct full name properly
            const fullName = full_name ||
                (first_name ? `${first_name}${last_name ? ' ' + last_name : ''}`.trim() : null);
            const userName = fullName || phone;
            const user = yield tx.user.create({
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
            const consumerProfile = yield tx.consumerProfile.create({
                data: {
                    userId: user.id,
                    fullName: fullName
                }
            });
            return { user, consumerProfile };
        }));
        res.status(201).json({
            success: true,
            message: 'Customer created successfully',
            customer: Object.assign(Object.assign({}, result.consumerProfile), { user: result.user })
        });
    }
    catch (error) {
        console.error('Create Customer Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.createCustomer = createCustomer;
const getRetailers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const retailers = yield prisma_1.default.retailerProfile.findMany({
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
            return Object.assign(Object.assign({}, retailer), { orders,
                revenue,
                creditLimit });
        });
        res.json({ success: true, retailers: formattedRetailers });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getRetailers = getRetailers;
// Create retailer
const createRetailer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password, business_name, phone, address, credit_limit } = req.body;
        // Check if user already exists
        const existingUser = yield prisma_1.default.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: `The email ${email} is already registered. Please use a unique business email.` });
        }
        if (!(0, email_validator_1.validateBusinessEmailFormat)(email, 'retailer')) {
            return res.status(400).json({ error: 'Retailer email must follow the format: name.retailer@big.co.rw' });
        }
        const actualPassword = password || crypto_1.default.randomBytes(4).toString('hex');
        const hashedPassword = yield (0, auth_1.hashPassword)(actualPassword);
        const user = yield prisma_1.default.user.create({
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
        const retailer = yield prisma_1.default.retailerProfile.create({
            data: {
                userId: user.id,
                shopName: business_name,
                address,
                creditLimit: parseFloat(credit_limit || '0'),
                walletBalance: 0
            }
        });
        // Queue Onboarding Email (RET-EMAIL-001)
        yield email_queue_1.emailQueue.add('onboarding-email', {
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
    }
    catch (error) {
        console.error('Create Retailer Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.createRetailer = createRetailer;
// Get wholesalers
const getWholesalers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const wholesalers = yield prisma_1.default.wholesalerProfile.findMany({
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
            return Object.assign(Object.assign({}, wholesaler), { orders,
                revenue });
        });
        res.json({ success: true, wholesalers: formattedWholesalers });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getWholesalers = getWholesalers;
// Create wholesaler
const createWholesaler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password, company_name, phone, address } = req.body;
        // Check if user already exists
        const existingUser = yield prisma_1.default.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: `The email ${email} is already registered. Please use a unique business email.` });
        }
        if (!(0, email_validator_1.validateBusinessEmailFormat)(email, 'wholesaler')) {
            return res.status(400).json({ error: 'Wholesaler email must follow the format: name.wholesaler@big.co.rw' });
        }
        const actualPassword = password || crypto_1.default.randomBytes(4).toString('hex');
        const hashedPassword = yield (0, auth_1.hashPassword)(actualPassword);
        const user = yield prisma_1.default.user.create({
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
        yield email_queue_1.emailQueue.add('onboarding-email', {
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
        yield prisma_1.default.wholesalerProfile.create({
            data: {
                userId: user.id,
                companyName: company_name,
                address
            }
        });
        res.json({ success: true, message: 'Wholesaler created successfully' });
    }
    catch (error) {
        console.error('Create Wholesaler Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.createWholesaler = createWholesaler;
// Get loans
const getLoans = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        // Fetch live interest rates from SystemConfig
        const config = yield prisma_1.default.systemConfig.findFirst();
        const rates = {
            customerInterestRate: (_a = config === null || config === void 0 ? void 0 : config.customerLoanInterest) !== null && _a !== void 0 ? _a : 10,
            retailerInterestRate: (_b = config === null || config === void 0 ? void 0 : config.retailerLoanInterest) !== null && _b !== void 0 ? _b : 0,
            wholesalerInterestRate: (_c = config === null || config === void 0 ? void 0 : config.wholesalerLoanInterest) !== null && _c !== void 0 ? _c : 8
        };
        // 1. Fetch Consumer Loans
        const consumerLoansRaw = yield prisma_1.default.loan.findMany({
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
        const consumerLoans = yield Promise.all(consumerLoansRaw.map((loan) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const repaymentTransactions = yield prisma_1.default.walletTransaction.findMany({
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
                yield prisma_1.default.loan.update({
                    where: { id: loan.id },
                    data: { status: 'repaid' }
                });
                loanStatus = 'repaid';
            }
            return {
                id: loan.id,
                user_id: ((_b = (_a = loan.consumerProfile) === null || _a === void 0 ? void 0 : _a.userId) === null || _b === void 0 ? void 0 : _b.toString()) || '',
                user_name: ((_c = loan.consumerProfile) === null || _c === void 0 ? void 0 : _c.fullName) || ((_e = (_d = loan.consumerProfile) === null || _d === void 0 ? void 0 : _d.user) === null || _e === void 0 ? void 0 : _e.name) || 'Customer',
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
                due_date: (_f = loan.dueDate) === null || _f === void 0 ? void 0 : _f.toISOString()
            };
        })));
        // 2. Fetch Retailer Stock Loans (CreditRequests)
        const creditRequestsRaw = yield prisma_1.default.creditRequest.findMany({
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
            var _a, _b, _c, _d, _e;
            const rate = Number(rates.retailerInterestRate) || 0;
            const interestAmount = Math.round(cr.amount * (rate / 100));
            const totalRepayable = cr.amount + interestAmount;
            let st = cr.status;
            if (st === 'pending')
                st = 'pending';
            else if (st === 'approved')
                st = 'active';
            else if (st === 'rejected')
                st = 'rejected';
            else
                st = 'completed';
            return {
                id: 10000 + cr.id,
                user_id: ((_b = (_a = cr.retailerProfile) === null || _a === void 0 ? void 0 : _a.userId) === null || _b === void 0 ? void 0 : _b.toString()) || '',
                user_name: ((_c = cr.retailerProfile) === null || _c === void 0 ? void 0 : _c.shopName) || 'Retailer Shop',
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
                lender: ((_e = (_d = cr.retailerProfile) === null || _d === void 0 ? void 0 : _d.linkedWholesaler) === null || _e === void 0 ? void 0 : _e.companyName) || 'Associated Wholesaler Shop',
                created_at: cr.createdAt.toISOString(),
                due_date: new Date(cr.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
            };
        });
        // 3. Dynamic Wholesaler Loans based on Supplier Payments (Outstanding bills acting as wholesaler liabilities)
        const supplierPayments = yield prisma_1.default.supplierPayment.findMany({
            include: {
                supplier: true,
                wholesalerProfile: {
                    include: { user: true }
                }
            }
        });
        const wholesalerLoans = supplierPayments.map((sp) => {
            var _a, _b, _c;
            const rate = Number(rates.wholesalerInterestRate) || 8;
            const interestAmount = Math.round(sp.amount * (rate / 100));
            const totalRepayable = sp.amount + interestAmount;
            return {
                id: 20000 + sp.id,
                user_id: ((_b = (_a = sp.wholesalerProfile) === null || _a === void 0 ? void 0 : _a.userId) === null || _b === void 0 ? void 0 : _b.toString()) || sp.wholesalerId.toString(),
                user_name: ((_c = sp.wholesalerProfile) === null || _c === void 0 ? void 0 : _c.companyName) || 'Wholesaler Company',
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
    }
    catch (error) {
        console.error('Get Admin Loans Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getLoans = getLoans;
// Get NFC cards
const getNFCCards = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cards = yield prisma_1.default.nfcCard.findMany({
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
        const formattedCards = yield Promise.all(cards.map((card) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const dashboardWallet = (_a = card.consumerProfile) === null || _a === void 0 ? void 0 : _a.wallets.find(w => w.type === 'dashboard_wallet');
            const creditWallet = (_b = card.consumerProfile) === null || _b === void 0 ? void 0 : _b.wallets.find(w => w.type === 'credit_wallet');
            // Calculate actual transaction count from both Retail sales and Gas recharges
            let transactionCount = 0;
            if (card.consumerId) {
                const [salesCount, gasCount] = yield Promise.all([
                    prisma_1.default.sale.count({ where: { consumerId: card.consumerId, paymentMethod: 'nfc_card' } }),
                    prisma_1.default.gasRechargeTransaction.count({ where: { customerId: card.consumerId, paymentMethod: 'nfc_card' } })
                ]);
                transactionCount = salesCount + gasCount;
            }
            // Fallback cascading logic to find accurate user identification
            const candidateName = ((_c = card.consumerProfile) === null || _c === void 0 ? void 0 : _c.fullName) ||
                ((_e = (_d = card.consumerProfile) === null || _d === void 0 ? void 0 : _d.user) === null || _e === void 0 ? void 0 : _e.name) ||
                ((_f = card.retailerProfile) === null || _f === void 0 ? void 0 : _f.shopName) ||
                ((_h = (_g = card.retailerProfile) === null || _g === void 0 ? void 0 : _g.user) === null || _h === void 0 ? void 0 : _h.name) ||
                card.cardholderName ||
                'Unassigned';
            return {
                id: card.id,
                uid: card.uid,
                status: card.status === 'available' ? 'active' : card.status,
                balance: card.balance,
                dashboardBalance: (dashboardWallet === null || dashboardWallet === void 0 ? void 0 : dashboardWallet.balance) || 0,
                creditBalance: (creditWallet === null || creditWallet === void 0 ? void 0 : creditWallet.balance) || 0,
                user_name: candidateName,
                transaction_count: transactionCount,
                user_type: card.consumerProfile ? 'consumer' : (card.retailerProfile ? 'retailer' : undefined),
                created_at: card.createdAt,
                last_used: card.updatedAt,
                consumerProfile: card.consumerProfile
            };
        })));
        res.json({ success: true, cards: formattedCards });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getNFCCards = getNFCCards;
// ==========================================
// CATEGORY MANAGEMENT
// ==========================================
const getCategories = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const categories = yield prisma_1.default.category.findMany({
            orderBy: { name: 'asc' }
        });
        // Manually count products for each category to be Railway-safe without schema migrations
        const categoriesWithCount = yield Promise.all(categories.map((cat) => __awaiter(void 0, void 0, void 0, function* () {
            const productCount = yield prisma_1.default.product.count({
                where: {
                    category: cat.name,
                    status: 'active'
                }
            });
            return Object.assign(Object.assign({}, cat), { productCount });
        })));
        res.json({ success: true, categories: categoriesWithCount });
    }
    catch (error) {
        console.error('Get Categories Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getCategories = getCategories;
const createCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, description, code } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        // Check if code exists
        if (code) {
            const existing = yield prisma_1.default.category.findUnique({ where: { code } });
            if (existing)
                return res.status(400).json({ success: false, message: 'Category code already exists' });
        }
        const category = yield prisma_1.default.category.create({
            data: {
                name,
                code: code || name.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
                description,
                isActive: true
            }
        });
        res.status(201).json({ success: true, category, message: 'Category created successfully' });
    }
    catch (error) {
        console.error('Create Category Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.createCategory = createCategory;
const updateCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, code, description, isActive } = req.body;
        // Fetch old category to see if name changed
        const oldCategory = yield prisma_1.default.category.findUnique({
            where: { id: Number(id) }
        });
        const category = yield prisma_1.default.category.update({
            where: { id: Number(id) },
            data: { name, code, description, isActive }
        });
        // Rename category on all products if name changed
        if (oldCategory && oldCategory.name !== name) {
            console.log(`Renaming product categories from "${oldCategory.name}" to "${name}"`);
            yield prisma_1.default.product.updateMany({
                where: { category: oldCategory.name },
                data: { category: name }
            });
        }
        res.json({ success: true, category, message: 'Category updated successfully' });
    }
    catch (error) {
        console.error('Update Category Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.updateCategory = updateCategory;
const deleteCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // Find category name first
        const categoryObj = yield prisma_1.default.category.findUnique({
            where: { id: Number(id) }
        });
        if (categoryObj) {
            // Set category of all products with this name to 'Uncategorized'
            yield prisma_1.default.product.updateMany({
                where: { category: categoryObj.name },
                data: { category: 'Uncategorized' }
            });
        }
        yield prisma_1.default.category.delete({ where: { id: Number(id) } });
        res.json({ success: true, message: 'Category deleted successfully' });
    }
    catch (error) {
        console.error('Delete Category Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.deleteCategory = deleteCategory;
// ==========================================
// RETAILER MANAGEMENT (Extra CRUD)
// ==========================================
const updateRetailer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // RetailerProfile ID
        const { business_name, email, phone, address, credit_limit, status } = req.body;
        const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(id) } });
        if (!retailer)
            return res.status(404).json({ error: 'Retailer not found' });
        // Check for duplicate phone on OTHER users
        if (phone) {
            const existingUser = yield prisma_1.default.user.findFirst({
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
            const existingUser = yield prisma_1.default.user.findFirst({
                where: {
                    email,
                    id: { not: retailer.userId }
                }
            });
            if (existingUser) {
                return res.status(400).json({ error: `Email ${email} is already in use by another account` });
            }
        }
        yield prisma_1.default.retailerProfile.update({
            where: { id: Number(id) },
            data: {
                shopName: business_name,
                address,
                creditLimit: credit_limit ? Number(credit_limit) : undefined,
            }
        });
        if (phone || business_name || status) {
            yield prisma_1.default.user.update({
                where: { id: retailer.userId },
                data: {
                    phone,
                    name: business_name,
                    isActive: status === 'active'
                }
            });
        }
        res.json({ success: true, message: 'Retailer updated' });
    }
    catch (error) {
        console.error('Update Retailer Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.updateRetailer = updateRetailer;
const deleteRetailer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(id) } });
        if (retailer) {
            // Delete profile first to satisfy FK
            yield prisma_1.default.retailerProfile.delete({ where: { id: Number(id) } });
            // Then delete user
            yield prisma_1.default.user.delete({ where: { id: retailer.userId } });
        }
        res.json({ success: true, message: 'Retailer deleted' });
    }
    catch (error) {
        console.error('Delete Retailer Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.deleteRetailer = deleteRetailer;
const verifyRetailer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // Check if retailer exists
        const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(id) } });
        if (!retailer)
            return res.status(404).json({ success: false, message: 'Retailer not found' });
        // Update isVerified status
        yield prisma_1.default.retailerProfile.update({
            where: { id: Number(id) },
            data: { isVerified: true }
        });
        res.json({ success: true, message: 'Retailer verified successfully' });
    }
    catch (error) {
        console.error('Verify Retailer Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.verifyRetailer = verifyRetailer;
const verifyWholesaler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // Check if wholesaler exists
        const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(id) } });
        if (!wholesaler)
            return res.status(404).json({ success: false, message: 'Wholesaler not found' });
        // Update isVerified status
        yield prisma_1.default.wholesalerProfile.update({
            where: { id: Number(id) },
            data: { isVerified: true }
        });
        res.json({ success: true, message: 'Wholesaler verified successfully' });
    }
    catch (error) {
        console.error('Verify Wholesaler Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.verifyWholesaler = verifyWholesaler;
// ==========================================
// WHOLESALER MANAGEMENT (Extra CRUD)
// ==========================================
const updateWholesaler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { company_name, email, phone, address, status } = req.body;
        const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(id) } });
        if (!wholesaler)
            return res.status(404).json({ error: 'Wholesaler not found' });
        // Check for duplicate phone on OTHER users
        if (phone) {
            const existingUser = yield prisma_1.default.user.findFirst({
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
            const existingUser = yield prisma_1.default.user.findFirst({
                where: {
                    email,
                    id: { not: wholesaler.userId }
                }
            });
            if (existingUser) {
                return res.status(400).json({ error: `Email ${email} is already in use by another account` });
            }
        }
        yield prisma_1.default.wholesalerProfile.update({
            where: { id: Number(id) },
            data: {
                companyName: company_name,
                address
            }
        });
        if (phone || company_name || status) {
            yield prisma_1.default.user.update({
                where: { id: wholesaler.userId },
                data: {
                    phone,
                    name: company_name,
                    isActive: status === 'active'
                }
            });
        }
        res.json({ success: true, message: 'Wholesaler updated' });
    }
    catch (error) {
        console.error('Update Wholesaler Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.updateWholesaler = updateWholesaler;
const deleteWholesaler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(id) } });
        if (wholesaler) {
            // Delete profile first to satisfy FK
            yield prisma_1.default.wholesalerProfile.delete({ where: { id: Number(id) } });
            // Then delete user
            yield prisma_1.default.user.delete({ where: { id: wholesaler.userId } });
        }
        res.json({ success: true, message: 'Wholesaler deleted' });
    }
    catch (error) {
        console.error('Delete Wholesaler Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.deleteWholesaler = deleteWholesaler;
const updateRetailerStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { isActive, status } = req.body;
        console.log(`Updating Retailer Status - ID: ${id}, isActive: ${isActive}, status: ${status}`);
        const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(id) } });
        if (!retailer) {
            console.log(`Retailer NOT FOUND for ID: ${id}`);
            return res.status(404).json({ error: 'Retailer not found' });
        }
        // Determine new status
        let newStatus = false;
        if (typeof isActive === 'boolean') {
            newStatus = isActive;
        }
        else if (status === 'active') {
            newStatus = true;
        }
        else if (status === 'inactive') {
            newStatus = false;
        }
        console.log(`Resolved status for User ${retailer.userId}: ${newStatus}`);
        // Update User status
        const updatedUser = yield prisma_1.default.user.update({
            where: { id: retailer.userId },
            data: {
                isActive: newStatus
            }
        });
        // Notify User of account action (PRD 2.A.iv)
        if (updatedUser.email) {
            yield email_queue_1.emailQueue.add('account-action-alert', {
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
    }
    catch (error) {
        console.error('Update Retailer Status Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.updateRetailerStatus = updateRetailerStatus;
const updateWholesalerStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { isActive, status } = req.body;
        console.log(`Updating Wholesaler Status - ID: ${id}, isActive: ${isActive}, status: ${status}`);
        const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(id) } });
        if (!wholesaler) {
            console.log(`Wholesaler NOT FOUND for ID: ${id}`);
            return res.status(404).json({ error: 'Wholesaler not found' });
        }
        // Determine new status
        let newStatus = false;
        if (typeof isActive === 'boolean') {
            newStatus = isActive;
        }
        else if (status === 'active') {
            newStatus = true;
        }
        else if (status === 'inactive') {
            newStatus = false;
        }
        console.log(`Resolved status for User ${wholesaler.userId}: ${newStatus}`);
        // Update User status
        const updatedUser = yield prisma_1.default.user.update({
            where: { id: wholesaler.userId },
            data: {
                isActive: newStatus
            }
        });
        // Notify User of account action (PRD 2.A.iv)
        if (updatedUser.email) {
            yield email_queue_1.emailQueue.add('account-action-alert', {
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
    }
    catch (error) {
        console.error('Update Wholesaler Status Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.updateWholesalerStatus = updateWholesalerStatus;
// ==========================================
// CUSTOMER MANAGEMENT (Extra CRUD)
// ==========================================
// Note: createCustomer is now defined earlier in the file (after getCustomer)
const updateCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // ConsumerProfile ID
        const { firstName, lastName, email, phone, status } = req.body;
        const profile = yield prisma_1.default.consumerProfile.findUnique({ where: { id: Number(id) } });
        if (!profile)
            return res.status(404).json({ error: 'Customer not found' });
        // Check if email/phone is taken by ANOTHER user
        if (email || phone) {
            const orConditions = [];
            if (email)
                orConditions.push({ email });
            if (phone)
                orConditions.push({ phone });
            if (orConditions.length > 0) {
                const existingUser = yield prisma_1.default.user.findFirst({
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
        yield prisma_1.default.user.update({
            where: { id: profile.userId },
            data: {
                name: `${firstName} ${lastName}`,
                email,
                phone,
                isActive: status === 'active'
            }
        });
        yield prisma_1.default.consumerProfile.update({
            where: { id: Number(id) },
            data: { fullName: `${firstName} ${lastName}` }
        });
        res.json({ success: true, message: 'Customer updated' });
    }
    catch (error) {
        console.error('Update Customer Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.updateCustomer = updateCustomer;
const updateCustomerStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, isActive } = req.body;
        console.log(`[AdminAPI] updateCustomerStatus - ID: ${id}, isActive: ${isActive}, status: ${status}`);
        // Determine new status
        let newStatus = false;
        if (typeof isActive === 'boolean') {
            newStatus = isActive;
        }
        else if (status === 'active') {
            newStatus = true;
        }
        else if (status === 'inactive') {
            newStatus = false;
        }
        const targetId = Number(id);
        // Check if it's a profile ID
        let profile = yield prisma_1.default.consumerProfile.findUnique({ where: { id: targetId } });
        let updatedUser;
        if (profile) {
            console.log(`[AdminAPI] Found ConsumerProfile by ID ${targetId}, updating user ${profile.userId}`);
            updatedUser = yield prisma_1.default.user.update({
                where: { id: profile.userId },
                data: { isActive: newStatus }
            });
        }
        else {
            // Check if it's a user ID directly (legacy support)
            const user = yield prisma_1.default.user.findUnique({ where: { id: targetId } });
            if (!user) {
                console.error(`[AdminAPI] Customer not found for ID ${targetId}`);
                return res.status(404).json({ error: 'Customer not found' });
            }
            console.log(`[AdminAPI] Found User by ID ${targetId}, updating directly`);
            updatedUser = yield prisma_1.default.user.update({
                where: { id: user.id },
                data: { isActive: newStatus }
            });
        }
        // Trigger Account Activation/Deactivation SMS (CUS-SMS-012)
        if (updatedUser && updatedUser.phone) {
            try {
                const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                yield emailQueue.add('customer-account-status', {
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
            }
            catch (err) {
                console.error('[AdminAPI] Failed to trigger customer-account-status notification:', err.message);
            }
        }
        if (updatedUser && updatedUser.email) {
            try {
                const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                yield emailQueue.add('customer-account-status-email', {
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
            }
            catch (err) {
                console.error('[AdminAPI] Failed to trigger customer-account-status-email notification:', err.message);
            }
        }
        res.json({ success: true, message: `Customer account ${newStatus ? 'activated' : 'deactivated'} successfully` });
    }
    catch (error) {
        console.error('[AdminAPI] updateCustomerStatus Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.updateCustomerStatus = updateCustomerStatus;
const deleteCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const profile = yield prisma_1.default.consumerProfile.findUnique({
            where: { id: Number(id) },
            include: { wallets: true }
        });
        if (!profile) {
            return res.status(404).json({ success: false, message: 'Customer profile not found' });
        }
        // Manual Cascade Deletion
        yield prisma_1.default.$transaction([
            // 1. Delete Wallet Transactions
            prisma_1.default.walletTransaction.deleteMany({
                where: { walletId: { in: profile.wallets.map(w => w.id) } }
            }),
            // 2. Delete Wallets
            prisma_1.default.wallet.deleteMany({ where: { consumerId: Number(id) } }),
            // 3. Delete Gas Topups and Rewards
            prisma_1.default.gasTopup.deleteMany({ where: { consumerId: Number(id) } }),
            prisma_1.default.gasReward.deleteMany({ where: { consumerId: Number(id) } }),
            // 4. Delete Gas Meters
            prisma_1.default.gasMeter.deleteMany({ where: { consumerId: Number(id) } }),
            // 5. Delete Customer Orders
            prisma_1.default.customerOrder.deleteMany({ where: { consumerId: Number(id) } }),
            // 6. Delete Loans
            prisma_1.default.loan.deleteMany({ where: { consumerId: Number(id) } }),
            // 7. Unlink or delete NFC cards (unlinking is safer if cards are reusable)
            prisma_1.default.nfcCard.updateMany({
                where: { consumerId: Number(id) },
                data: { consumerId: null, status: 'inactive' }
            }),
            // 7.5 Delete Sale Items
            prisma_1.default.saleItem.deleteMany({
                where: { sale: { consumerId: Number(id) } }
            }),
            // 8. Delete Sales (if they belong to this consumer)
            prisma_1.default.sale.deleteMany({ where: { consumerId: Number(id) } }),
            // 9. Delete Settings
            prisma_1.default.consumerSettings.deleteMany({ where: { consumerId: Number(id) } }),
            // 10. Delete Messages and Notifications
            prisma_1.default.message.deleteMany({
                where: { OR: [{ senderId: profile.userId }, { receiverId: profile.userId }] }
            }),
            prisma_1.default.notification.deleteMany({ where: { userId: profile.userId } }),
            // 11. Delete the profile itself
            prisma_1.default.consumerProfile.delete({ where: { id: Number(id) } }),
            // 12. Finally delete the User record
            prisma_1.default.user.delete({ where: { id: profile.userId } })
        ]);
        res.json({ success: true, message: 'Customer and all associated data deleted successfully' });
    }
    catch (error) {
        console.error('Delete Customer Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.deleteCustomer = deleteCustomer;
// Get all products (Aggregated by SKU/Name for total stock)
const getProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rawProducts = yield prisma_1.default.product.findMany({
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
                    wholesalerProds: [],
                    retailerProds: [],
                    allProds: []
                });
            }
            const entry = groupedMap.get(key);
            entry.allProds.push(product);
            if (product.retailerId !== null) {
                entry.retailerProds.push(product);
            }
            else {
                entry.wholesalerProds.push(product);
            }
        });
        const products = Array.from(groupedMap.values()).map(entry => {
            const primaryWholesaler = entry.wholesalerProds[0];
            const primaryRetailer = entry.retailerProds[0];
            const representative = primaryWholesaler || primaryRetailer;
            const copy = Object.assign({}, representative);
            // Sum stock across all records
            copy.stock = entry.allProds.reduce((sum, p) => sum + (p.stock || 0), 0);
            // Determine clean prices
            copy.supplierPrice = primaryWholesaler ? (primaryWholesaler.costPrice || 0) : 0;
            copy.wholesalerPrice = primaryWholesaler ? (primaryWholesaler.price || 0) : (primaryRetailer ? (primaryRetailer.costPrice || 0) : 0);
            copy.retailerPrice = primaryRetailer ? (primaryRetailer.price || 0) : (primaryWholesaler ? (primaryWholesaler.retailerPrice || 0) : 0);
            return copy;
        });
        res.json({ products });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.getProducts = getProducts;
// Create product
const createProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, description, sku, category, price, costPrice, retailerPrice, stock, unit, lowStockThreshold, invoiceNumber, barcode, wholesalerId, retailerId, image } = req.body;
        // Upload to Cloudinary if image is provided as base64
        let imageUrl = image;
        if (image && image.startsWith('data:image')) {
            imageUrl = yield (0, cloudinary_1.uploadImage)(image);
        }
        const product = yield prisma_1.default.product.create({
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
    }
    catch (error) {
        console.error('Create Product Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.createProduct = createProduct;
// Update product (Updates ALL products with the same SKU/Name to enforce Tariff)
const updateProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, description, sku, category, price, costPrice, retailerPrice, stock, unit, lowStockThreshold, invoiceNumber, barcode, status, image } = req.body;
        const targetProduct = yield prisma_1.default.product.findUnique({ where: { id: Number(id) } });
        if (!targetProduct) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const whereClause = targetProduct.sku ? { sku: targetProduct.sku } : { name: targetProduct.name };
        // Upload to Cloudinary if new image is provided as base64
        let imageUrl = image;
        if (image && image.startsWith('data:image')) {
            imageUrl = yield (0, cloudinary_1.uploadImage)(image);
        }
        const parsedStock = stock !== undefined && stock !== null ? parseFloat(stock) : undefined;
        // Update Wholesaler products (where retailerId is null)
        // Only update stock for wholesaler products if the target product being edited is a wholesaler product
        yield prisma_1.default.product.updateMany({
            where: Object.assign(Object.assign({}, whereClause), { retailerId: null }),
            data: Object.assign({ name,
                description,
                sku,
                category, price: price ? parseFloat(price) : undefined, costPrice: costPrice !== undefined ? (costPrice ? parseFloat(costPrice) : null) : undefined, retailerPrice: retailerPrice !== undefined ? (retailerPrice ? parseFloat(retailerPrice) : null) : undefined, stock: targetProduct.retailerId === null ? parsedStock : undefined, unit, lowStockThreshold: lowStockThreshold !== undefined ? (lowStockThreshold ? parseInt(lowStockThreshold) : null) : undefined, invoiceNumber,
                barcode,
                status }, (imageUrl ? { image: imageUrl } : {}))
        });
        // Update Retailer products (where retailerId is not null)
        // Only update stock for retailer products if the target product being edited is a retailer product
        yield prisma_1.default.product.updateMany({
            where: Object.assign(Object.assign({}, whereClause), { retailerId: { not: null } }),
            data: Object.assign({ name,
                description,
                sku,
                category, 
                // For retailers, Selling Price is the Retailer Price, and Cost Price is the Wholesaler Price
                price: retailerPrice ? parseFloat(retailerPrice) : undefined, costPrice: price ? parseFloat(price) : undefined, stock: targetProduct.retailerId !== null ? parsedStock : undefined, unit, lowStockThreshold: lowStockThreshold !== undefined ? (lowStockThreshold ? parseInt(lowStockThreshold) : null) : undefined, invoiceNumber,
                barcode,
                status }, (imageUrl ? { image: imageUrl } : {}))
        });
        const product = yield prisma_1.default.product.findUnique({ where: { id: Number(id) } });
        res.json({ success: true, product });
    }
    catch (error) {
        console.error('Update Product Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.updateProduct = updateProduct;
// Delete product (Deletes ALL products with the same SKU/Name, with soft delete fallback)
const deleteProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const targetProduct = yield prisma_1.default.product.findUnique({ where: { id: Number(id) } });
        if (!targetProduct) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const whereClause = targetProduct.sku ? { sku: targetProduct.sku } : { name: targetProduct.name };
        try {
            // Attempt hard delete (works if the product has never been ordered or sold)
            yield prisma_1.default.product.deleteMany({ where: whereClause });
            res.json({ success: true, message: 'Products permanently deleted successfully' });
        }
        catch (dbError) {
            // If there are foreign key constraint references (e.g. P2003 error), fall back to soft delete
            console.warn('Hard delete failed due to active constraints. Falling back to soft delete.', dbError.message);
            yield prisma_1.default.product.updateMany({
                where: whereClause,
                data: { status: 'deleted' }
            });
            res.json({ success: true, message: 'Products soft-deleted successfully' });
        }
    }
    catch (error) {
        console.error('Delete Product Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.deleteProduct = deleteProduct;
// ==========================================
// EMPLOYEE MANAGEMENT
// ==========================================
// Get All Employees
const getEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employees = yield prisma_1.default.employeeProfile.findMany({
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.getEmployees = getEmployees;
// Create Employee
const createEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, phone, department, position, salary, dateOfJoining, bankAccount, password // Get password from request
         } = req.body;
        const fullName = `${firstName} ${lastName}`;
        // check existing
        const existingUser = yield prisma_1.default.user.findFirst({
            where: { OR: [{ email }, { phone }] }
        });
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email or phone already exists' });
        }
        // Generate random password or use default
        const finalPassword = password || 'employee123';
        const hashedPassword = yield (0, auth_1.hashPassword)(finalPassword);
        // Generate Employee Number (simple auto-increment logic or random)
        const count = yield prisma_1.default.employeeProfile.count();
        const employeeNumber = `EMP${(count + 1).toString().padStart(3, '0')}`;
        // Transaction to create User and Profile
        const result = yield prisma_1.default.$transaction((prisma) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield prisma.user.create({
                data: {
                    email,
                    phone,
                    name: fullName,
                    password: hashedPassword,
                    role: 'employee',
                    isActive: true
                }
            });
            const profile = yield prisma.employeeProfile.create({
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
        }));
        res.status(201).json({
            success: true,
            message: 'Employee created successfully',
            employee: result
        });
    }
    catch (error) {
        console.error('Create Employee Error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.createEmployee = createEmployee;
// Update Employee
const updateEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // This is the EmployeeProfile ID
        const { firstName, lastName, email, phone, department, position, salary, status, dateOfJoining, bankAccount } = req.body;
        const fullName = `${firstName} ${lastName}`;
        // Find profile first
        const profile = yield prisma_1.default.employeeProfile.findUnique({
            where: { id: Number(id) },
            include: { user: true }
        });
        if (!profile) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        // Update User and Profile
        yield prisma_1.default.$transaction([
            prisma_1.default.user.update({
                where: { id: profile.userId },
                data: {
                    name: fullName,
                    email,
                    phone,
                    isActive: status === 'active'
                }
            }),
            prisma_1.default.employeeProfile.update({
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.updateEmployee = updateEmployee;
// Delete Employee
const deleteEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // EmployeeProfile ID
        const profile = yield prisma_1.default.employeeProfile.findUnique({
            where: { id: Number(id) }
        });
        if (!profile) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        // Delete User (Cascade will handle profile deletion if configured, but let's be explicit or rely on schema)
        // In our updated schema we added onDelete: Cascade to the relation.
        // So deleting the User deletes the Profile.
        yield prisma_1.default.user.delete({
            where: { id: profile.userId }
        });
        res.json({ success: true, message: 'Employee deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.deleteEmployee = deleteEmployee;
// ==========================================
// LOAN MANAGEMENT
// ==========================================
const approveLoan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const numericId = Number(id);
        // Support Retailer Stock Loans (mapped as 10000 + ID)
        if (numericId > 10000) {
            const realId = numericId - 10000;
            const request = yield prisma_1.default.creditRequest.findUnique({
                where: { id: realId }
            });
            if (!request)
                throw new Error('Credit request not found');
            if (request.status !== 'pending')
                throw new Error('Request already processed');
            yield prisma_1.default.creditRequest.update({
                where: { id: realId },
                data: {
                    status: 'approved',
                    reviewedAt: new Date(),
                    reviewNotes: 'Approved by Admin via Loans Module'
                }
            });
            // Update Retailer Credit
            const credit = yield prisma_1.default.retailerCredit.findUnique({
                where: { retailerId: request.retailerId }
            });
            if (credit) {
                yield prisma_1.default.retailerCredit.update({
                    where: { id: credit.id },
                    data: {
                        availableCredit: { increment: request.amount }
                    }
                });
            }
            else {
                yield prisma_1.default.retailerCredit.create({
                    data: {
                        retailerId: request.retailerId,
                        creditLimit: request.amount,
                        availableCredit: request.amount,
                        usedCredit: 0
                    }
                });
            }
            // Fetch dynamic interest rates from SystemConfig for Retailer
            const systemConfig = yield prisma_1.default.systemConfig.findFirst();
            const interestRate = (_a = systemConfig === null || systemConfig === void 0 ? void 0 : systemConfig.retailerLoanInterest) !== null && _a !== void 0 ? _a : 18;
            const interestAmount = request.amount * (interestRate / 100);
            const totalRepayable = request.amount + interestAmount;
            // Create missing RetailerLoan record to show up in retailer portal
            yield prisma_1.default.retailerLoan.create({
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
        const result = yield prisma_1.default.$transaction((prisma) => __awaiter(void 0, void 0, void 0, function* () {
            const loan = yield prisma.loan.findUnique({
                where: { id: numericId },
                include: { consumerProfile: true }
            });
            if (!loan)
                throw new Error('Loan not found');
            if (loan.status !== 'pending')
                throw new Error('Loan is already processed');
            // 1. Update Loan status
            const updatedLoan = yield prisma.loan.update({
                where: { id: numericId },
                data: {
                    status: 'approved',
                    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                }
            });
            // 2. Get or Create Credit Wallet
            let creditWallet = yield prisma.wallet.findFirst({
                where: { consumerId: loan.consumerId, type: 'credit_wallet' }
            });
            if (!creditWallet) {
                creditWallet = yield prisma.wallet.create({
                    data: {
                        consumerId: loan.consumerId,
                        type: 'credit_wallet',
                        balance: 0,
                        currency: 'RWF'
                    }
                });
            }
            // 3. Add to Credit Wallet Balance
            yield prisma.wallet.update({
                where: { id: creditWallet.id },
                data: { balance: { increment: loan.amount } }
            });
            // 4. Create Transaction
            yield prisma.walletTransaction.create({
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
        }), {
            timeout: 45000 // Increase transaction timeout to 45 seconds to prevent timeout crashes on slow DB queries / high network latency
        });
        res.json({ success: true, loan: result });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.approveLoan = approveLoan;
const rejectLoan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const numericId = Number(id);
        if (numericId > 10000) {
            const realId = numericId - 10000;
            yield prisma_1.default.creditRequest.update({
                where: { id: realId },
                data: {
                    status: 'rejected',
                    reviewedAt: new Date(),
                    reviewNotes: reason || 'Rejected by admin'
                }
            });
            return res.json({ success: true, loan: { id: numericId, status: 'rejected' } });
        }
        const loan = yield prisma_1.default.loan.update({
            where: { id: numericId },
            data: { status: 'rejected' }
        });
        res.json({ success: true, loan });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.rejectLoan = rejectLoan;
// ==========================================
// NFC CARD MANAGEMENT
// ==========================================
const registerNFCCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { uid, pin, cardType, cardholderName, nationalId, phone, email, province, district, sector, cell, streetAddress, landmark, userId // Optional: Valid User ID passed from frontend
         } = req.body;
        if (!uid)
            return res.status(400).json({ error: 'UID is required' });
        const existing = yield prisma_1.default.nfcCard.findUnique({ where: { uid } });
        if (existing)
            return res.status(400).json({ error: 'NFC Card with this UID already exists' });
        // Try to link to a consumer
        let consumerId = null;
        let finalStatus = 'active';
        // 1. If userId provided explicitly
        if (userId) {
            const profile = yield prisma_1.default.consumerProfile.findFirst({ where: { userId: Number(userId) } }); // Assuming userId is User model ID
            if (profile)
                consumerId = profile.id;
            else {
                // Maybe it WAS the consumerProfile ID?
                const profileById = yield prisma_1.default.consumerProfile.findUnique({ where: { id: Number(userId) } });
                if (profileById)
                    consumerId = profileById.id;
            }
        }
        // 2. If no userId, try to match by phone
        else if (phone) {
            const user = yield prisma_1.default.user.findFirst({ where: { phone } });
            if (user) {
                const profile = yield prisma_1.default.consumerProfile.findUnique({ where: { userId: user.id } });
                if (profile)
                    consumerId = profile.id;
            }
        }
        // CLIENT REQUIREMENT: Reject creation if not linked to valid existing customer
        if (!consumerId) {
            return res.status(400).json({ error: 'NFC cards must be assigned only to an existing customer account.' });
        }
        const card = yield prisma_1.default.nfcCard.create({
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.registerNFCCard = registerNFCCard;
const getNFCCardTransactions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // Find the card and its linked consumer
        const card = yield prisma_1.default.nfcCard.findUnique({
            where: { id: Number(id) }
        });
        if (!card) {
            return res.status(404).json({ success: false, error: 'Card not found' });
        }
        if (!card.consumerId) {
            return res.json({ success: true, transactions: [] });
        }
        // Fetch both regular retail sales and gas recharges performed by this consumer using NFC
        const [sales, gasRecharges] = yield Promise.all([
            prisma_1.default.sale.findMany({
                where: {
                    consumerId: card.consumerId,
                    paymentMethod: 'nfc_card'
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            }),
            prisma_1.default.gasRechargeTransaction.findMany({
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
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getNFCCardTransactions = getNFCCardTransactions;
const blockNFCCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const card = yield prisma_1.default.nfcCard.update({
            where: { id: Number(id) },
            data: { status: 'blocked' }
        });
        res.json({ success: true, card });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.blockNFCCard = blockNFCCard;
const activateNFCCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const card = yield prisma_1.default.nfcCard.update({
            where: { id: Number(id) },
            data: { status: 'available' }
        });
        res.json({ success: true, card });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.activateNFCCard = activateNFCCard;
const unlinkNFCCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const card = yield prisma_1.default.nfcCard.update({
            where: { id: Number(id) },
            data: {
                consumerId: null,
                retailerId: null,
                status: 'available' // Reset to available upon unlink
            }
        });
        res.json({ success: true, card });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.unlinkNFCCard = unlinkNFCCard;
// ==========================================
// REPORTS
// ==========================================
const getTransactionReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { startDate, endDate, groupBy } = req.query;
        const where = {};
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate)
                where.createdAt.gte = new Date(startDate);
            if (endDate)
                where.createdAt.lte = new Date(endDate);
        }
        const txs = yield prisma_1.default.walletTransaction.findMany({
            where,
            orderBy: { createdAt: 'asc' }
        });
        // Group by period
        const report = [];
        const grouped = {};
        txs.forEach(tx => {
            const date = new Date(tx.createdAt);
            let period = '';
            if (groupBy === 'month') {
                period = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            }
            else {
                period = date.toISOString().split('T')[0];
            }
            // Map types to frontend expectations
            let type = tx.type;
            if (type === 'topup' || type === 'top_up')
                type = 'wallet_topup';
            if (type === 'gas_payment' || type === 'gas_topup')
                type = 'gas_purchase';
            if (type === 'loan' || type === 'disbursement')
                type = 'loan_disbursement';
            if (type === 'nfc')
                type = 'nfc_payment';
            const key = `${period}_${type}`;
            if (!grouped[key]) {
                grouped[key] = { period, type, count: 0, total_amount: 0 };
            }
            grouped[key].count += 1;
            grouped[key].total_amount = Math.round(grouped[key].total_amount + tx.amount);
        });
        res.json({ success: true, report: Object.values(grouped) });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.getTransactionReport = getTransactionReport;
const getRevenueReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { startDate, endDate, groupBy } = req.query;
        const where = {};
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate)
                where.createdAt.gte = new Date(startDate);
            if (endDate)
                where.createdAt.lte = new Date(endDate);
        }
        // Revenue comes from Sales and GasTopups
        const [sales, gasTopups] = yield Promise.all([
            prisma_1.default.sale.findMany({ where, orderBy: { createdAt: 'asc' } }),
            prisma_1.default.gasTopup.findMany({ where, orderBy: { createdAt: 'asc' } })
        ]);
        const grouped = {};
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.getRevenueReport = getRevenueReport;
// ==========================================
// SYSTEM CONFIGURATION
// ==========================================
const customRatesPath = path_1.default.join(__dirname, '..', 'customRates.json');
const getCustomRates = () => {
    try {
        if (fs_1.default.existsSync(customRatesPath)) {
            const data = fs_1.default.readFileSync(customRatesPath, 'utf8');
            return JSON.parse(data);
        }
    }
    catch (e) {
        console.error('Error reading custom rates:', e);
    }
    return {
        customerInterestRate: 10,
        retailerInterestRate: 5,
        wholesalerInterestRate: 8
    };
};
const saveCustomRates = (rates) => {
    try {
        const existing = getCustomRates();
        const updated = Object.assign(Object.assign({}, existing), { customerInterestRate: rates.customerInterestRate !== undefined ? Number(rates.customerInterestRate) : existing.customerInterestRate, retailerInterestRate: rates.retailerInterestRate !== undefined ? Number(rates.retailerInterestRate) : existing.retailerInterestRate, wholesalerInterestRate: rates.wholesalerInterestRate !== undefined ? Number(rates.wholesalerInterestRate) : existing.wholesalerInterestRate });
        fs_1.default.writeFileSync(customRatesPath, JSON.stringify(updated, null, 2), 'utf8');
    }
    catch (e) {
        console.error('Error saving custom rates:', e);
    }
};
const getSystemConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let config = yield prisma_1.default.systemConfig.findFirst();
        // Create default config if it doesn't exist
        if (!config) {
            const defaultData = {
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
            config = yield prisma_1.default.systemConfig.create({
                data: defaultData
            });
        }
        const rates = getCustomRates();
        res.json({ success: true, config: Object.assign(Object.assign({}, config), rates) });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.getSystemConfig = getSystemConfig;
const recalculateAllProductsBackground = (config) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔄 Starting background recalculation of all product prices...');
        // Fetch all products that have a supplierCost set (to avoid messing up legacy products without costs)
        const products = yield prisma_1.default.product.findMany({
            where: {
                wholesalerId: { not: null },
                supplierCost: { not: null }
            }
        });
        const wholesalerMarkupPct = (config === null || config === void 0 ? void 0 : config.wholesalerMarkup) || 20;
        const retailerMarkupPct = (config === null || config === void 0 ? void 0 : config.retailerMarkup) || 25;
        const exciseDutyRatePct = (config === null || config === void 0 ? void 0 : config.exciseDutyRate) || 10;
        console.log(`📦 Found ${products.length} products to recalculate. Using Markups: W=${wholesalerMarkupPct}%, R=${retailerMarkupPct}%`);
        let updatedCount = 0;
        for (const product of products) {
            const prodAny = product;
            if (prodAny.supplierCost === null || prodAny.supplierCost === undefined)
                continue;
            const taxType = prodAny.taxType || 'B';
            // 1. Calculate Wholesaler Price
            const wholesalePricing = (0, pricingUtils_1.calculateWholesalePrice)(prodAny.supplierCost, wholesalerMarkupPct, taxType, exciseDutyRatePct);
            // 2. Calculate Retailer Price (using the wholesaler's pre-tax price as the retailer's clean base cost)
            const retailPricing = (0, pricingUtils_1.calculateRetailPrice)(wholesalePricing.preTaxPrice, retailerMarkupPct, taxType, exciseDutyRatePct);
            // 3. Update Product
            yield prisma_1.default.product.update({
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
        const retailerProducts = yield prisma_1.default.product.findMany({
            where: {
                retailerId: { not: null },
                costPrice: { not: null }
            }
        });
        console.log(`📦 Found ${retailerProducts.length} retailer products to recalculate. Using Markup: R=${retailerMarkupPct}%`);
        let retailUpdatedCount = 0;
        for (const rProduct of retailerProducts) {
            const rProdAny = rProduct;
            if (rProduct.costPrice === null || rProduct.costPrice === undefined)
                continue;
            // Find the corresponding wholesaler product robustly to get the correct live taxType
            const wholesalerProduct = yield prisma_1.default.product.findFirst({
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
            const taxType = (wholesalerProduct === null || wholesalerProduct === void 0 ? void 0 : wholesalerProduct.taxType) || rProdAny.taxType || 'B';
            const retailPricing = (0, pricingUtils_1.calculateRetailPrice)(rProduct.costPrice, retailerMarkupPct, taxType, exciseDutyRatePct);
            yield prisma_1.default.product.update({
                where: { id: rProduct.id },
                data: {
                    price: retailPricing.finalConsumerShelfPrice,
                    taxType: taxType
                }
            });
            retailUpdatedCount++;
        }
        console.log(`✅ Background recalculation complete for retailer products. Updated ${retailUpdatedCount} products.`);
    }
    catch (error) {
        console.error('❌ Error during background product recalculation:', error);
    }
});
const updateSystemConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = Object.assign({}, req.body);
        saveCustomRates(data);
        delete data.customerInterestRate;
        delete data.retailerInterestRate;
        delete data.wholesalerInterestRate;
        let config = yield prisma_1.default.systemConfig.findFirst();
        if (!config) {
            config = yield prisma_1.default.systemConfig.create({ data });
        }
        else {
            config = yield prisma_1.default.systemConfig.update({
                where: { id: config.id },
                data
            });
        }
        // Await background recalculation so that subsequent navigation shows updated prices immediately
        try {
            yield recalculateAllProductsBackground(config);
        }
        catch (err) {
            console.error('❌ Error triggering recalculation:', err);
        }
        const rates = getCustomRates();
        res.json({ success: true, config: Object.assign(Object.assign({}, config), rates) });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.updateSystemConfig = updateSystemConfig;
// ==========================================
// ADMIN REAL-TIME READ-ONLY ACCOUNT ACCESS
// ==========================================
// Get comprehensive real-time customer account details (READ-ONLY)
const getCustomerAccountDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { id } = req.params;
        const customer = yield prisma_1.default.consumerProfile.findUnique({
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
        const gasRewardsSum = yield prisma_1.default.gasReward.aggregate({
            where: { consumerId: customer.id },
            _sum: { units: true }
        });
        // Calculate wallet balances
        const walletSummary = {
            dashboardWallet: ((_a = customer.wallets.find(w => w.type === 'dashboard_wallet')) === null || _a === void 0 ? void 0 : _a.balance) || 0,
            rewardsWallet: ((_b = customer.wallets.find(w => w.type === 'rewards_wallet')) === null || _b === void 0 ? void 0 : _b.balance) || 0,
            gasRewardsWallet: gasRewardsSum._sum.units || 0,
            creditWallet: ((_c = customer.wallets.find(w => w.type === 'credit_wallet')) === null || _c === void 0 ? void 0 : _c.balance) || 0,
            gasBalance: customer.gasMeters.reduce((sum, m) => sum + (m.currentUnits || 0), 0)
        };
        // Fetch retailer profiles to link shop names for sales
        const retailerIds = [...new Set(customer.sales.map(s => s.retailerId))];
        const retailers = yield prisma_1.default.retailerProfile.findMany({
            where: { id: { in: retailerIds } },
            select: { id: true, shopName: true }
        });
        const retailerMap = new Map(retailers.map(r => [r.id, r]));
        // Format Sales (Retail Orders)
        const formattedSales = customer.sales.map(s => (Object.assign(Object.assign({}, s), { retailerProfile: retailerMap.get(s.retailerId) || { id: s.retailerId, shopName: 'Unknown Retailer' } })));
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
        const consolidatedOrders = [...formattedSales, ...formattedGasOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        // Filter completed and cancelled orders based on linked retailer's lastSettlementDate
        const lastSettlementDate = ((_d = customer.linkedRetailer) === null || _d === void 0 ? void 0 : _d.lastSettlementDate) ? new Date(customer.linkedRetailer.lastSettlementDate) : null;
        const filteredCompletedOrders = consolidatedOrders.filter(s => {
            const isCompleted = s.status === 'completed' || s.status === 'delivered';
            if (!isCompleted)
                return false;
            if (lastSettlementDate) {
                return new Date(s.createdAt) > lastSettlementDate;
            }
            return true;
        });
        const filteredCancelledOrders = consolidatedOrders.filter(s => {
            const isCancelled = s.status === 'cancelled';
            if (!isCancelled)
                return false;
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
        const allTransactions = customer.wallets.flatMap(w => w.walletTransactions.map(t => (Object.assign(Object.assign({}, t), { walletType: w.type })))).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        // Fetch global lastGasResetDate
        const resetAlert = yield prisma_1.default.systemAlert.findFirst({
            where: { apiName: 'GAS_REPORTING_PERIOD_RESET' },
            orderBy: { createdAt: 'desc' }
        });
        const lastGasResetDate = resetAlert ? new Date(resetAlert.errorMessage) : null;
        // Calculate actual total gas top-ups stats
        const totalGasTopupsSum = yield prisma_1.default.gasTopup.aggregate({
            where: Object.assign({ consumerId: customer.id, status: { in: ['completed', 'success'] } }, (lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {})),
            _count: { id: true },
            _sum: { amount: true, units: true }
        });
        const totalGasRewardsSum = yield prisma_1.default.gasReward.aggregate({
            where: Object.assign({ consumerId: customer.id }, (lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {})),
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
        const linkedRetailers = Array.from(new Set(formattedSales.map(s => { var _a; return (_a = s.retailerProfile) === null || _a === void 0 ? void 0 : _a.id; }).filter(Boolean)));
        const supplierChain = yield prisma_1.default.retailerProfile.findMany({
            where: { id: { in: linkedRetailers } },
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
                supplierChain: supplierChain.map(r => {
                    var _a, _b;
                    return ({
                        retailerId: r.id,
                        retailerName: r.shopName,
                        wholesalerId: (_a = r.linkedWholesaler) === null || _a === void 0 ? void 0 : _a.id,
                        wholesalerName: (_b = r.linkedWholesaler) === null || _b === void 0 ? void 0 : _b.companyName
                    });
                })
            }
        });
    }
    catch (error) {
        console.error('Get Customer Account Details Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getCustomerAccountDetails = getCustomerAccountDetails;
// Get comprehensive real-time retailer account details (READ-ONLY)
const getRetailerAccountDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { id } = req.params;
        const retailer = yield prisma_1.default.retailerProfile.findUnique({
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
        const wholesalerSettlementDate = ((_a = retailer.linkedWholesaler) === null || _a === void 0 ? void 0 : _a.lastSettlementDate) ? new Date(retailer.linkedWholesaler.lastSettlementDate) : null;
        const filteredWholesalerCompleted = retailer.orders.filter(o => {
            const isCompleted = o.status === 'completed' || o.status === 'delivered';
            if (!isCompleted)
                return false;
            if (wholesalerSettlementDate) {
                return new Date(o.createdAt) > wholesalerSettlementDate;
            }
            return true;
        });
        const filteredWholesalerCancelled = retailer.orders.filter(o => {
            const isCancelled = o.status === 'cancelled';
            if (!isCancelled)
                return false;
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
            if (s.status === 'cancelled')
                return false;
            if (retailerSettlementDate) {
                return new Date(s.createdAt) >= retailerSettlementDate;
            }
            return true;
        });
        const filteredCustomerCompleted = retailer.sales.filter(s => {
            const isCompleted = s.status === 'completed' || s.status === 'delivered';
            if (!isCompleted)
                return false;
            if (retailerSettlementDate) {
                return new Date(s.createdAt) >= retailerSettlementDate;
            }
            return true;
        });
        const filteredCustomerCancelled = retailer.sales.filter(s => {
            const isCancelled = s.status === 'cancelled';
            if (!isCancelled)
                return false;
            if (retailerSettlementDate) {
                return new Date(s.createdAt) >= retailerSettlementDate;
            }
            return true;
        });
        // Fetch gas rewards given
        const gasRewardsAggregate = yield prisma_1.default.gasReward.aggregate({
            where: Object.assign({ sale: {
                    retailerId: retailer.id
                } }, (retailerSettlementDate ? { createdAt: { gte: retailerSettlementDate } } : {})),
            _sum: {
                units: true
            }
        });
        const systemConfig = yield prisma_1.default.systemConfig.findFirst();
        const gasRewardsM3 = gasRewardsAggregate._sum.units || 0;
        const gasRewardsRwf = Math.round(gasRewardsM3 * ((systemConfig === null || systemConfig === void 0 ? void 0 : systemConfig.gasPricePerM3) || 6500));
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
        const activeLoans = (retailer.retailerLoans || []).filter((l) => { var _a; return ((_a = l.status) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === 'active'; });
        const outstandingLoanBalance = activeLoans.reduce((sum, l) => sum + (l.remainingAmount || 0), 0);
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
        const retailerMarkup = (systemConfig === null || systemConfig === void 0 ? void 0 : systemConfig.retailerMarkup) || 20;
        const settlementDateForProfit = retailer.lastSettlementDate ? new Date(retailer.lastSettlementDate) : null;
        let totalSalesRevenue = 0;
        let totalSalesCost = 0;
        for (const sale of retailer.sales) {
            if (sale.status === 'cancelled')
                continue;
            // Apply same date filter as retailer dashboard: only count sales after lastSettlementDate
            if (settlementDateForProfit && new Date(sale.createdAt) < settlementDateForProfit)
                continue;
            for (const item of sale.saleItems || []) {
                const revenue = (item.price || 0) * (item.quantity || 0);
                const cost = ((_b = item.product) === null || _b === void 0 ? void 0 : _b.costPrice) && item.product.costPrice > 0
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
                products: retailer.inventory,
                creditRequests: retailer.creditRequests,
                lastOrder,
                linkedWholesaler: retailer.linkedWholesaler ? {
                    id: retailer.linkedWholesaler.id,
                    companyName: retailer.linkedWholesaler.companyName,
                    phone: (_c = retailer.linkedWholesaler.user) === null || _c === void 0 ? void 0 : _c.phone,
                    email: (_d = retailer.linkedWholesaler.user) === null || _d === void 0 ? void 0 : _d.email
                } : null
            }
        });
    }
    catch (error) {
        console.error('Get Retailer Account Details Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getRetailerAccountDetails = getRetailerAccountDetails;
// Get comprehensive real-time worker/employee account details (READ-ONLY)
const getWorkerAccountDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const employee = yield prisma_1.default.employeeProfile.findUnique({
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
    }
    catch (error) {
        console.error('Get Worker Account Details Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getWorkerAccountDetails = getWorkerAccountDetails;
// Get wholesaler account details with linked retailers (READ-ONLY)
const getWholesalerAccountDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({
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
        const systemConfig = yield prisma_1.default.systemConfig.findFirst();
        const wholesalerMarkupPct = (systemConfig === null || systemConfig === void 0 ? void 0 : systemConfig.wholesalerMarkup) || 20;
        const orderItems = yield prisma_1.default.orderItem.findMany({
            where: {
                order: Object.assign({ wholesalerId: wholesaler.id }, (dateFilter ? { createdAt: dateFilter } : {}))
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
                linkedRetailers: wholesaler.linkedRetailers.map(r => {
                    var _a, _b;
                    return ({
                        id: r.id,
                        shopName: r.shopName,
                        phone: r.user.phone,
                        email: r.user.email,
                        isActive: r.user.isActive,
                        creditLimit: ((_a = r.credit) === null || _a === void 0 ? void 0 : _a.creditLimit) || r.creditLimit,
                        usedCredit: ((_b = r.credit) === null || _b === void 0 ? void 0 : _b.usedCredit) || 0
                    });
                }),
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
    }
    catch (error) {
        console.error('Get Wholesaler Account Details Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getWholesalerAccountDetails = getWholesalerAccountDetails;
// ==========================================
// ADMIN PROXY — WHOLESALER ORDER ACTIONS
// Admin can perform the same order actions as the wholesaler,
// identified by wholesaler profile ID from the URL.
// ==========================================
const adminConfirmWholesalerOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { wId, orderId } = req.params;
        const wholesalerProfile = yield prisma_1.default.wholesalerProfile.findUnique({
            where: { id: Number(wId) },
            include: { user: true }
        });
        if (!wholesalerProfile) {
            return res.status(404).json({ success: false, error: 'Wholesaler not found' });
        }
        const order = yield prisma_1.default.order.findUnique({ where: { id: Number(orderId) } });
        if (!order)
            return res.status(404).json({ success: false, error: 'Order not found' });
        if (order.wholesalerId !== wholesalerProfile.id) {
            return res.status(403).json({ success: false, error: 'Order does not belong to this wholesaler' });
        }
        if (order.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Cannot confirm order with status: ${order.status}` });
        }
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const orderWithItems = yield tx.order.findUnique({
                where: { id: Number(orderId) },
                include: { orderItems: { include: { product: true } } }
            });
            if (!orderWithItems)
                throw new Error('Order not found');
            for (const item of orderWithItems.orderItems) {
                if (!item.product)
                    throw new Error(`Product not found for item ${item.productId}`);
                if (item.product.stock < item.quantity) {
                    throw new Error(`Insufficient stock for ${item.product.name}. Available: ${item.product.stock}, Required: ${item.quantity}`);
                }
                yield tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { decrement: item.quantity } }
                });
            }
            const updatedOrder = yield tx.order.update({
                where: { id: Number(orderId) },
                data: { status: 'confirmed' },
                include: { orderItems: { include: { product: true } }, retailerProfile: { include: { user: true } } }
            });
            return updatedOrder;
        }), { timeout: 15000 });
        res.json({ success: true, order: result, message: 'Order confirmed and stock deducted successfully' });
    }
    catch (error) {
        console.error('Admin Confirm Wholesaler Order Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.adminConfirmWholesalerOrder = adminConfirmWholesalerOrder;
const adminRejectWholesalerOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { wId, orderId } = req.params;
        const { reason } = req.body;
        const wholesalerProfile = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
        if (!wholesalerProfile)
            return res.status(404).json({ success: false, error: 'Wholesaler not found' });
        const order = yield prisma_1.default.order.findUnique({ where: { id: Number(orderId) } });
        if (!order)
            return res.status(404).json({ success: false, error: 'Order not found' });
        if (order.wholesalerId !== wholesalerProfile.id) {
            return res.status(403).json({ success: false, error: 'Order does not belong to this wholesaler' });
        }
        if (!['pending', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ success: false, error: `Cannot reject order with status: ${order.status}` });
        }
        const updatedOrder = yield prisma_1.default.order.update({
            where: { id: Number(orderId) },
            data: { status: 'rejected', rejectionReason: reason || 'Rejected by admin' }
        });
        res.json({ success: true, order: updatedOrder, message: 'Order rejected successfully' });
    }
    catch (error) {
        console.error('Admin Reject Wholesaler Order Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.adminRejectWholesalerOrder = adminRejectWholesalerOrder;
const adminShipWholesalerOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const wholesalerProfile = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
        if (!wholesalerProfile)
            return res.status(404).json({ success: false, error: 'Wholesaler not found' });
        const order = yield prisma_1.default.order.findUnique({ where: { id: Number(orderId) } });
        if (!order)
            return res.status(404).json({ success: false, error: 'Order not found' });
        if (order.wholesalerId !== wholesalerProfile.id) {
            return res.status(403).json({ success: false, error: 'Order does not belong to this wholesaler' });
        }
        if (order.status !== 'confirmed') {
            return res.status(400).json({ success: false, error: `Cannot ship order with status: ${order.status}. Order must be confirmed first.` });
        }
        const updatedOrder = yield prisma_1.default.order.update({
            where: { id: Number(orderId) },
            data: { status: 'shipped', shipperName, shipperPhone, vehiclePlate }
        });
        res.json({ success: true, order: updatedOrder, message: 'Order shipped successfully' });
    }
    catch (error) {
        console.error('Admin Ship Wholesaler Order Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.adminShipWholesalerOrder = adminShipWholesalerOrder;
// ==========================================
// ADMIN PROXY — WHOLESALER INVENTORY ACTIONS
// ==========================================
const adminUpdateWholesalerProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { wId, productId } = req.params;
        const { name, category, unit, low_stock_threshold, invoice_number, barcode, description, image } = req.body;
        const wholesalerProfile = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
        if (!wholesalerProfile)
            return res.status(404).json({ success: false, error: 'Wholesaler not found' });
        const currentProduct = yield prisma_1.default.product.findUnique({
            where: { id: Number(productId), wholesalerId: wholesalerProfile.id }
        });
        if (!currentProduct)
            return res.status(404).json({ success: false, error: 'Product not found' });
        let imageUrl = image;
        if (image && image.startsWith('data:image')) {
            const { uploadImage } = yield Promise.resolve().then(() => __importStar(require('../utils/cloudinary')));
            imageUrl = yield uploadImage(image);
        }
        const product = yield prisma_1.default.product.update({
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
            }
        });
        res.json({ success: true, product });
    }
    catch (error) {
        console.error('Admin Update Wholesaler Product Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.adminUpdateWholesalerProduct = adminUpdateWholesalerProduct;
const adminUpdateWholesalerStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { wId, productId } = req.params;
        const { quantity, type, reason } = req.body;
        const wholesalerProfile = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
        if (!wholesalerProfile)
            return res.status(404).json({ success: false, error: 'Wholesaler not found' });
        const currentProduct = yield prisma_1.default.product.findUnique({
            where: { id: Number(productId), wholesalerId: wholesalerProfile.id }
        });
        if (!currentProduct)
            return res.status(404).json({ success: false, error: 'Product not found' });
        let newStock = currentProduct.stock;
        const amount = parseInt(quantity);
        if (type === 'add')
            newStock += amount;
        else if (type === 'remove')
            newStock = Math.max(0, newStock - amount);
        else if (type === 'set')
            newStock = amount;
        const product = yield prisma_1.default.product.update({
            where: { id: Number(productId) },
            data: { stock: newStock }
        });
        res.json({ success: true, product });
    }
    catch (error) {
        console.error('Admin Update Wholesaler Stock Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.adminUpdateWholesalerStock = adminUpdateWholesalerStock;
const adminDeleteWholesalerProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { wId, productId } = req.params;
        const wholesalerProfile = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(wId) } });
        if (!wholesalerProfile)
            return res.status(404).json({ success: false, error: 'Wholesaler not found' });
        yield prisma_1.default.product.delete({
            where: { id: Number(productId), wholesalerId: wholesalerProfile.id }
        });
        res.json({ success: true, message: 'Product deleted successfully' });
    }
    catch (error) {
        console.error('Admin Delete Wholesaler Product Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.adminDeleteWholesalerProduct = adminDeleteWholesalerProduct;
// ==========================================
// WHOLESALER-RETAILER LINKING (ACCOUNT LINKING ENFORCEMENT)
// ==========================================
// Get retailer-wholesaler linkage for admin panel
const getRetailerWholesalerLinkage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const retailers = yield prisma_1.default.retailerProfile.findMany({
            include: {
                user: { select: { phone: true, email: true, isActive: true } },
                linkedWholesaler: {
                    select: { id: true, companyName: true, user: { select: { phone: true } } }
                }
            }
        });
        const wholesalers = yield prisma_1.default.wholesalerProfile.findMany({
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
                retailers: retailers.map(r => {
                    var _a;
                    return ({
                        id: r.id,
                        shopName: r.shopName,
                        phone: r.user.phone,
                        isActive: r.user.isActive,
                        linkedWholesalerId: r.linkedWholesalerId,
                        linkedWholesalerName: ((_a = r.linkedWholesaler) === null || _a === void 0 ? void 0 : _a.companyName) || null
                    });
                }),
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
    }
    catch (error) {
        console.error('Get Retailer-Wholesaler Linkage Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getRetailerWholesalerLinkage = getRetailerWholesalerLinkage;
// Link retailer to wholesaler (Admin function)
const linkRetailerToWholesaler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { retailerId, wholesalerId } = req.body;
        if (!retailerId || !wholesalerId) {
            return res.status(400).json({ success: false, error: 'Both retailerId and wholesalerId are required' });
        }
        const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(retailerId) } });
        if (!retailer) {
            return res.status(404).json({ success: false, error: 'Retailer not found' });
        }
        const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(wholesalerId) } });
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
        yield prisma_1.default.retailerProfile.update({
            where: { id: Number(retailerId) },
            data: { linkedWholesalerId: Number(wholesalerId) }
        });
        res.json({ success: true, message: 'Retailer successfully linked to wholesaler' });
    }
    catch (error) {
        console.error('Link Retailer to Wholesaler Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.linkRetailerToWholesaler = linkRetailerToWholesaler;
// Unlink retailer from wholesaler (Admin function)
const unlinkRetailerFromWholesaler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { retailerId } = req.body;
        if (!retailerId) {
            return res.status(400).json({ success: false, error: 'retailerId is required' });
        }
        const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(retailerId) } });
        if (!retailer) {
            return res.status(404).json({ success: false, error: 'Retailer not found' });
        }
        yield prisma_1.default.retailerProfile.update({
            where: { id: Number(retailerId) },
            data: { linkedWholesalerId: null }
        });
        res.json({ success: true, message: 'Retailer successfully unlinked from wholesaler' });
    }
    catch (error) {
        console.error('Unlink Retailer from Wholesaler Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.unlinkRetailerFromWholesaler = unlinkRetailerFromWholesaler;
// ==========================================
// SETTLEMENT INVOICE MANAGEMENT
// ==========================================
// Get all settlement invoices with filters
const getSettlementInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month, partyType, partyId } = req.query;
        const where = {};
        if (month)
            where.settlementMonth = month;
        if (partyType)
            where.partyType = partyType;
        if (partyId) {
            if (partyType === 'retailer') {
                where.retailerId = Number(partyId);
            }
            else if (partyType === 'wholesaler') {
                where.wholesalerId = Number(partyId);
            }
        }
        const invoices = yield prisma_1.default.settlementInvoice.findMany({
            where,
            include: {
                retailerProfile: { select: { id: true, shopName: true } },
                wholesalerProfile: { select: { id: true, companyName: true } }
            },
            orderBy: [{ settlementMonth: 'desc' }, { createdAt: 'desc' }]
        });
        const formattedInvoices = invoices.map(inv => {
            var _a, _b;
            return ({
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                partyType: inv.partyType,
                partyId: inv.partyType === 'retailer' ? inv.retailerId : inv.wholesalerId,
                partyName: inv.partyType === 'retailer'
                    ? (_a = inv.retailerProfile) === null || _a === void 0 ? void 0 : _a.shopName
                    : (_b = inv.wholesalerProfile) === null || _b === void 0 ? void 0 : _b.companyName,
                settlementMonth: inv.settlementMonth,
                totalAmount: inv.totalAmount,
                invoiceFileUrl: inv.invoiceFileUrl,
                notes: inv.notes,
                uploadedBy: inv.uploadedBy,
                uploadedAt: inv.createdAt
            });
        });
        res.json({ success: true, invoices: formattedInvoices });
    }
    catch (error) {
        console.error('Get Settlement Invoices Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getSettlementInvoices = getSettlementInvoices;
// Create/upload a settlement invoice
const createSettlementInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { partyType, partyId, settlementMonth, totalAmount, invoiceFileUrl, notes } = req.body;
        const uploadedBy = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
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
            const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(partyId) } });
            if (!retailer)
                return res.status(404).json({ success: false, error: 'Retailer not found' });
        }
        else {
            const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(partyId) } });
            if (!wholesaler)
                return res.status(404).json({ success: false, error: 'Wholesaler not found' });
        }
        // Generate invoice number
        const count = yield prisma_1.default.settlementInvoice.count();
        const invoiceNumber = `INV-${settlementMonth}-${(count + 1).toString().padStart(4, '0')}`;
        const invoice = yield prisma_1.default.settlementInvoice.create({
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
            invoice: Object.assign(Object.assign({}, invoice), { partyName: partyType === 'retailer'
                    ? (_b = invoice.retailerProfile) === null || _b === void 0 ? void 0 : _b.shopName
                    : (_c = invoice.wholesalerProfile) === null || _c === void 0 ? void 0 : _c.companyName })
        });
    }
    catch (error) {
        console.error('Create Settlement Invoice Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.createSettlementInvoice = createSettlementInvoice;
// Get single settlement invoice
const getSettlementInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const invoice = yield prisma_1.default.settlementInvoice.findUnique({
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
    }
    catch (error) {
        console.error('Get Settlement Invoice Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getSettlementInvoice = getSettlementInvoice;
// Update settlement invoice
const updateSettlementInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { totalAmount, invoiceFileUrl, notes } = req.body;
        const invoice = yield prisma_1.default.settlementInvoice.update({
            where: { id: Number(id) },
            data: {
                totalAmount: totalAmount !== undefined ? Number(totalAmount) : undefined,
                invoiceFileUrl,
                notes
            }
        });
        res.json({ success: true, message: 'Invoice updated successfully', invoice });
    }
    catch (error) {
        console.error('Update Settlement Invoice Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.updateSettlementInvoice = updateSettlementInvoice;
// Delete settlement invoice
const deleteSettlementInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.default.settlementInvoice.delete({ where: { id: Number(id) } });
        res.json({ success: true, message: 'Invoice deleted successfully' });
    }
    catch (error) {
        console.error('Delete Settlement Invoice Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.deleteSettlementInvoice = deleteSettlementInvoice;
// ==========================================
// ORDER MANAGMENT (Admin override)
// ==========================================
// Confirm delivery of an order (Admin overriding Wholesaler/Retailer)
const confirmWholesaleDelivery = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const order = yield prisma_1.default.order.findUnique({
            where: { id: Number(id) }
        });
        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        if (order.status !== 'shipped' && order.status !== 'processing' && order.status !== 'confirmed') {
            return res.status(400).json({ success: false, error: `Cannot confirm delivery for order with status: ${order.status}. Order must be shipped first.` });
        }
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // 1. Update order status
            const updatedOrder = yield tx.order.update({
                where: { id: Number(id) },
                data: { status: 'delivered' },
                include: {
                    orderItems: { include: { product: true } },
                    retailerProfile: true
                }
            });
            // Fetch SystemConfig for Retailer Inheritance Pipeline
            const config = yield prisma_1.default.systemConfig.findFirst();
            const configAny = config;
            const wholesalerMarkupPct = (configAny === null || configAny === void 0 ? void 0 : configAny.wholesalerMarkup) || 20;
            const retailerMarkupPct = (configAny === null || configAny === void 0 ? void 0 : configAny.retailerMarkup) || 20;
            const exciseDutyRatePct = (configAny === null || configAny === void 0 ? void 0 : configAny.exciseDutyRate) || 10;
            const { calculateRetailPrice } = yield Promise.resolve().then(() => __importStar(require('../utils/pricingUtils')));
            // 2. Update Retailer's Inventory
            for (const item of updatedOrder.orderItems) {
                if (!item.product)
                    continue;
                // Search for existing product in retailer's inventory
                const existingProduct = yield tx.product.findFirst({
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
                    const conversionFactor = existingProduct.conversionFactor ? Number(existingProduct.conversionFactor) : null;
                    let addStock = item.quantity;
                    if (conversionFactor && conversionFactor > 0) {
                        addStock = item.quantity * conversionFactor;
                    }
                    yield tx.product.update({
                        where: { id: existingProduct.id },
                        data: {
                            stock: { increment: addStock },
                            taxType: item.product.taxType || 'B'
                        }
                    });
                }
                else {
                    // Create new product for retailer based on wholesaler's product
                    // Retailer Inheritance Pipeline
                    const prodAny = item.product;
                    const supplierCost = prodAny.supplierCost || item.product.costPrice || 0;
                    const cleanBaseCost = supplierCost * (1 + wholesalerMarkupPct / 100);
                    const taxType = prodAny.taxType || 'B';
                    const retailPricing = calculateRetailPrice(cleanBaseCost, retailerMarkupPct, taxType, exciseDutyRatePct);
                    const conversionFactor = item.product.conversionFactor ? Number(item.product.conversionFactor) : null;
                    let addStock = item.quantity;
                    if (conversionFactor && conversionFactor > 0) {
                        addStock = item.quantity * conversionFactor;
                    }
                    yield tx.product.create({
                        data: {
                            name: item.product.name,
                            description: item.product.description,
                            sku: item.product.sku,
                            barcode: item.product.barcode,
                            category: item.product.category,
                            price: retailPricing.finalConsumerShelfPrice, // Module 2 generated Final Consumer Shelf Price
                            costPrice: cleanBaseCost, // Retailer's cost basis (Taxes stripped out)
                            stock: addStock,
                            retailerId: updatedOrder.retailerId,
                            unit: item.product.unit,
                            baseUnit: item.product.baseUnit,
                            purchaseUnit: item.product.purchaseUnit,
                            conversionFactor: item.product.conversionFactor,
                            status: 'active',
                            taxType: taxType,
                            supplierCost: item.product.price // The actual invoice amount they paid for the stock
                        }
                    });
                }
            }
            return updatedOrder;
        }), { timeout: 15000 });
        res.json({ success: true, order: result, message: 'Delivery confirmed and retailer stock updated by Admin' });
    }
    catch (error) {
        console.error('Error confirming delivery by Admin:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.confirmWholesaleDelivery = confirmWholesaleDelivery;
/**
 * Get system email logs for monitoring
 */
const getEmailLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 50, status, channel, search } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const where = {};
        if (status)
            where.status = status;
        if (channel)
            where.channel = channel;
        if (search) {
            where.OR = [
                { recipientEmail: { contains: search } },
                { recipientPhone: { contains: search } },
                { templateType: { contains: search } },
                { relatedEntityId: { contains: search } },
                // @ts-ignore
                { subject: { contains: search } }
            ];
        }
        const [logs, total] = yield Promise.all([
            prisma_1.default.systemEmailLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                take: Number(limit),
                skip: skip
            }),
            prisma_1.default.systemEmailLog.count({ where })
        ]);
        res.json({
            success: true,
            logs,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit))
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getEmailLogs = getEmailLogs;
/**
 * Resend a failed email manually from logs
 */
const resendEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const log = yield prisma_1.default.systemEmailLog.findUnique({
            where: { id: Number(id) }
        });
        if (!log) {
            return res.status(404).json({ success: false, error: 'Email log not found' });
        }
        // Add back to queue (Requirement 4.2.9)
        yield email_queue_1.emailQueue.add('manual-resend', {
            to: log.recipientEmail,
            // @ts-ignore
            subject: log.subject,
            templateType: log.templateType,
            logId: log.id,
        });
        res.json({ success: true, message: 'Email has been queued for resending' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.resendEmail = resendEmail;
/**
 * Get all email templates
 */
const getEmailTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // @ts-ignore
        const templates = yield prisma_1.default.emailTemplate.findMany({
            orderBy: { name: 'asc' }
        });
        res.json({ success: true, templates });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getEmailTemplates = getEmailTemplates;
/**
 * Create or Update an email template
 */
const saveEmailTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, subject, content, description, isActive, portal, triggerName, channel } = req.body;
        // @ts-ignore
        const template = yield prisma_1.default.emailTemplate.upsert({
            where: { name },
            update: { subject, content, description, isActive, portal, triggerName, channel },
            create: { name, subject, content, description, isActive, portal, triggerName, channel }
        });
        // Auto-map event slug if triggerName is provided to ensure delivery/trigger
        if (triggerName) {
            const eventSlug = triggerName.trim();
            // @ts-ignore
            yield prisma_1.default.emailEvent.upsert({
                where: { eventSlug },
                update: { templateName: name, description: `Auto-mapped event for template ${name}` },
                create: { eventSlug, templateName: name, description: `Auto-mapped event for template ${name}` }
            });
        }
        res.json({ success: true, template, message: 'Template saved successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.saveEmailTemplate = saveEmailTemplate;
/**
 * Delete an email template
 */
const deleteEmailTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // @ts-ignore
        yield prisma_1.default.emailTemplate.delete({
            where: { id: Number(id) }
        });
        res.json({ success: true, message: 'Template deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.deleteEmailTemplate = deleteEmailTemplate;
/**
 * Send manual email/announcement to selected users
 */
const sendManualEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { recipients, groups, subject, html, category } = req.body;
        let targetRecipients = Array.isArray(recipients) ? [...recipients] : [];
        if (groups && Array.isArray(groups) && groups.length > 0) {
            const roleMap = {
                'Customers': 'consumer',
                'Retailers': 'retailer',
                'Wholesalers': 'wholesaler',
                'customers': 'consumer',
                'retailers': 'retailer',
                'wholesalers': 'wholesaler'
            };
            const rolesToQuery = groups.map(g => roleMap[g] || g.toLowerCase());
            const groupUsers = yield prisma_1.default.user.findMany({
                where: {
                    role: { in: rolesToQuery },
                    isActive: true,
                    email: { not: null }
                },
                select: { email: true }
            });
            const groupEmails = groupUsers.map(u => u.email).filter(e => e && e.trim() !== '');
            targetRecipients = Array.from(new Set([...targetRecipients, ...groupEmails]));
        }
        if (targetRecipients.length === 0) {
            return res.status(400).json({ success: false, error: 'No recipients resolved' });
        }
        // Query names for recipients to dynamically replace placeholders
        const users = yield prisma_1.default.user.findMany({
            where: { email: { in: targetRecipients } }
        });
        const userMap = new Map(users.map(u => { var _a; return [(_a = u.email) === null || _a === void 0 ? void 0 : _a.toLowerCase(), u]; }));
        // Add each to queue (Requirement 4.2.10)
        const jobs = targetRecipients.map(email => {
            const u = userMap.get(email.toLowerCase());
            const name = (u === null || u === void 0 ? void 0 : u.name) || 'Valued Customer';
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
        yield email_queue_1.emailQueue.addBulk(jobs);
        res.json({ success: true, message: `Queued ${targetRecipients.length} emails successfully` });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.sendManualEmail = sendManualEmail;
/**
 * Get all email event mappings
 */
const getEmailEvents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // @ts-ignore
        const events = yield prisma_1.default.emailEvent.findMany({
            orderBy: { eventSlug: 'asc' }
        });
        res.json({ success: true, events });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getEmailEvents = getEmailEvents;
/**
 * Update an email event mapping
 */
const updateEmailEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { templateName, description } = req.body;
        if (templateName) {
            // Fetch the template to check its target portal
            // @ts-ignore
            const template = yield prisma_1.default.emailTemplate.findUnique({
                where: { name: templateName }
            });
            if (!template) {
                return res.status(404).json({ success: false, error: `Template '${templateName}' not found` });
            }
            // Fetch the event to get its slug
            // @ts-ignore
            const event = yield prisma_1.default.emailEvent.findUnique({
                where: { id: Number(id) }
            });
            if (!event) {
                return res.status(404).json({ success: false, error: 'Event mapping not found' });
            }
            const eventSlug = event.eventSlug.toLowerCase();
            let eventPortal = 'SHARED';
            if (eventSlug.startsWith('wholesaler-') || eventSlug.startsWith('who-')) {
                eventPortal = 'WHOLESALER';
            }
            else if (eventSlug.startsWith('customer-') || eventSlug.startsWith('cus-')) {
                eventPortal = 'CUSTOMER';
            }
            else if (eventSlug.startsWith('retailer-') || eventSlug.startsWith('ret-')) {
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
        const event = yield prisma_1.default.emailEvent.update({
            where: { id: Number(id) },
            data: { templateName, description }
        });
        res.json({ success: true, event, message: 'Event mapping updated successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.updateEmailEvent = updateEmailEvent;
// ==========================================
// SYSTEM ALERTS
// ==========================================
const getSystemAlerts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const alerts = yield prisma_1.default.systemAlert.findMany({
            orderBy: { failureTime: 'desc' }
        });
        res.json({ success: true, alerts });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getSystemAlerts = getSystemAlerts;
const acknowledgeAlert = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const alert = yield prisma_1.default.systemAlert.update({
            where: { id: Number(id) },
            data: {
                status: 'resolved',
                resolvedTime: new Date()
            }
        });
        res.json({ success: true, alert, message: 'Alert acknowledged successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.acknowledgeAlert = acknowledgeAlert;
const updateCustomerCreditLimit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // ConsumerProfile ID
        const { creditLimit } = req.body;
        if (creditLimit === undefined || isNaN(parseFloat(creditLimit)) || parseFloat(creditLimit) < 0) {
            return res.status(400).json({ success: false, error: 'Invalid credit limit amount' });
        }
        const profile = yield prisma_1.default.consumerProfile.update({
            where: { id: Number(id) },
            data: { creditLimit: parseFloat(creditLimit) }
        });
        res.json({ success: true, profile, message: 'Customer credit limit updated successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.updateCustomerCreditLimit = updateCustomerCreditLimit;
const getCustomerCreditLimit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // ConsumerProfile ID
        const profile = yield prisma_1.default.consumerProfile.findUnique({
            where: { id: Number(id) },
            include: { user: { select: { name: true, email: true, phone: true } } }
        });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        res.json({ success: true, creditLimit: profile.creditLimit || 50000, profile });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getCustomerCreditLimit = getCustomerCreditLimit;
// Refund Requests
const getRefundRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const refundRequests = yield prisma_1.default.walletTransaction.findMany({
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
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getRefundRequests = getRefundRequests;
const processRefundRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { id } = req.params;
        const { action, reason } = req.body; // action: 'approve' or 'reject'
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, error: 'Invalid action' });
        }
        const transaction = yield prisma_1.default.walletTransaction.findUnique({
            where: { id: Number(id) },
            include: { wallet: { include: { consumerProfile: { include: { user: true } } } } }
        });
        if (!transaction) {
            return res.status(404).json({ success: false, error: 'Refund request not found' });
        }
        if (transaction.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Request is already processed' });
        }
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const newStatus = action === 'approve' ? 'approved' : 'rejected';
            // Update transaction status
            yield tx.walletTransaction.update({
                where: { id: transaction.id },
                data: {
                    status: newStatus,
                    description: reason ? `${transaction.description} - ${reason}` : transaction.description
                }
            });
            // If approved, deduct from wallet
            if (action === 'approve' && transaction.walletId) {
                const currentWallet = yield tx.wallet.findUnique({
                    where: { id: transaction.walletId }
                });
                if (currentWallet && currentWallet.balance < transaction.amount) {
                    throw new Error('Customer wallet has insufficient balance for this refund');
                }
                yield tx.wallet.update({
                    where: { id: transaction.walletId },
                    data: {
                        balance: { decrement: transaction.amount }
                    }
                });
                if (transaction.wallet && transaction.wallet.consumerId) {
                    const profileWalletCount = yield tx.wallet.findFirst({
                        where: { id: transaction.walletId, type: 'dashboard_wallet' }
                    });
                    if (profileWalletCount) {
                        yield tx.consumerProfile.update({
                            where: { id: transaction.wallet.consumerId },
                            data: { walletBalance: { decrement: transaction.amount } }
                        });
                    }
                }
            }
        }));
        // Trigger Customer Refund Notification (CUS-EMAIL-009)
        try {
            if ((_c = (_b = (_a = transaction.wallet) === null || _a === void 0 ? void 0 : _a.consumerProfile) === null || _b === void 0 ? void 0 : _b.user) === null || _c === void 0 ? void 0 : _c.email) {
                const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                yield emailQueue.add('customer-refund-request-email', {
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
        }
        catch (err) {
            console.error('Customer refund notification failed:', err);
        }
        res.json({ success: true, message: `Refund request ${action}d successfully` });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.processRefundRequest = processRefundRequest;
// ==========================================
// PROFIT INVOICES (Admin)
// ==========================================
const getAdminProfitInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const invoices = yield prisma_1.default.customProfitInvoice.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: invoices });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getAdminProfitInvoices = getAdminProfitInvoices;
const generateAdminProfitInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { recipientType, recipientId, recipientName, totalOrders, totalRevenue, grossProfit, tax, netProfit, recipientSharePct, recipientShareAmt, companySharePct, companyShareAmt, rewardsPoolPct, rewardsPoolAmt, rewardsGivenAmt, rentExpense, salariesExpense, otherExpense, totalExpense, finalPayable } = req.body;
        if (!recipientType || !recipientId) {
            return res.status(400).json({ success: false, error: 'Recipient Type and ID are required' });
        }
        const data = {
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
        }
        else {
            data.wholesalerId = Number(recipientId);
        }
        const newInvoice = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const invoice = yield tx.customProfitInvoice.create({ data });
            // Reset stats (by updating lastSettlementDate)
            const now = new Date();
            if (recipientType === 'Retailer') {
                yield tx.retailerProfile.update({
                    where: { id: Number(recipientId) },
                    data: { lastSettlementDate: now }
                });
                // Log global reset alert for Admin Customer Management dashboard (Total Orders & Total Revenue)
                yield tx.systemAlert.create({
                    data: {
                        apiName: 'RETAILER_PROFIT_INVOICE_RESET',
                        status: 'resolved',
                        errorMessage: now.toISOString()
                    }
                });
            }
            else {
                yield tx.wholesalerProfile.update({
                    where: { id: Number(recipientId) },
                    data: { lastSettlementDate: now }
                });
            }
            return invoice;
        }));
        res.json({ success: true, message: 'Profit invoice generated successfully', data: newInvoice });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.generateAdminProfitInvoice = generateAdminProfitInvoice;
const getProfitInvoiceRecipients = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const retailers = yield prisma_1.default.retailerProfile.findMany({
            where: { isVerified: true },
            select: { id: true, shopName: true }
        });
        const wholesalers = yield prisma_1.default.wholesalerProfile.findMany({
            where: { isVerified: true },
            select: { id: true, companyName: true }
        });
        const formattedRetailers = retailers.map(r => ({ id: r.id, name: r.shopName, type: 'Retailer' }));
        const formattedWholesalers = wholesalers.map(w => ({ id: w.id, name: w.companyName, type: 'Wholesaler' }));
        res.json({ success: true, data: [...formattedRetailers, ...formattedWholesalers] });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getProfitInvoiceRecipients = getProfitInvoiceRecipients;
const getProfitInvoiceStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { type, id } = req.params;
        let totalRevenue = 0;
        let totalCost = 0;
        let gasRewardsGiven = 0;
        if (type === 'Retailer') {
            const retailer = yield prisma_1.default.retailerProfile.findUnique({ where: { id: Number(id) } });
            if (!retailer)
                return res.status(404).json({ success: false, error: 'Retailer not found' });
            const dateFilter = retailer.lastSettlementDate ? { gte: retailer.lastSettlementDate } : undefined;
            const sales = yield prisma_1.default.sale.findMany({
                where: Object.assign({ retailerId: Number(id), status: { not: 'cancelled' } }, (dateFilter ? { createdAt: dateFilter } : {})),
                include: { saleItems: { include: { product: true } } }
            });
            const systemConfig = yield prisma_1.default.systemConfig.findFirst();
            const retailerMarkup = (systemConfig === null || systemConfig === void 0 ? void 0 : systemConfig.retailerMarkup) || 20;
            for (const sale of sales) {
                for (const item of sale.saleItems) {
                    totalRevenue += (item.price * item.quantity);
                    const cost = item.product.costPrice && item.product.costPrice > 0
                        ? item.product.costPrice
                        : item.price / (1 + retailerMarkup / 100);
                    totalCost += (cost * item.quantity);
                }
            }
            const [rewards] = yield Promise.all([
                prisma_1.default.gasReward.aggregate({
                    where: Object.assign({ sale: { retailerId: Number(id) } }, (dateFilter ? { createdAt: dateFilter } : {})),
                    _sum: { units: true }
                })
            ]);
            const gasUnits = rewards._sum.units || 0;
            const gasPrice = (systemConfig === null || systemConfig === void 0 ? void 0 : systemConfig.gasPricePerM3) || 6500;
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
        }
        else if (type === 'Wholesaler') {
            const wholesaler = yield prisma_1.default.wholesalerProfile.findUnique({ where: { id: Number(id) } });
            if (!wholesaler)
                return res.status(404).json({ success: false, error: 'Wholesaler not found' });
            const dateFilter = wholesaler.lastSettlementDate ? { gte: wholesaler.lastSettlementDate } : undefined;
            const orders = yield prisma_1.default.order.findMany({
                where: Object.assign({ wholesalerId: Number(id), status: { in: ['delivered', 'completed'] } }, (dateFilter ? { createdAt: dateFilter } : {})),
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
        }
        else {
            res.status(400).json({ success: false, error: 'Invalid type' });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getProfitInvoiceStats = getProfitInvoiceStats;
// End the month or term globally for gas reporting
const endGasPeriod = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        yield prisma_1.default.systemAlert.create({
            data: {
                apiName: 'GAS_REPORTING_PERIOD_RESET',
                status: 'resolved',
                errorMessage: now.toISOString()
            }
        });
        // Reset remaining units on all meters to zero
        yield prisma_1.default.gasMeter.updateMany({
            data: {
                currentUnits: 0
            }
        });
        res.json({ success: true, message: 'Gas reporting period ended successfully' });
    }
    catch (error) {
        console.error('End Gas Period Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.endGasPeriod = endGasPeriod;
