import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';
import { uploadImage } from '../utils/cloudinary';
import { emailQueue } from '../queues/email.queue';
import { calculateWholesalePrice } from '../utils/pricingUtils';
import { TemplateService } from '../services/template.service';

// Get dashboard stats with comprehensive calculations
export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    console.log('📊 Fetching dashboard stats for user:', req.user?.id);

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      console.error('❌ Wholesaler profile not found');
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dateFilter = wholesalerProfile.lastSettlementDate ? { gte: wholesalerProfile.lastSettlementDate } : undefined;

    // Fetch all necessary data in parallel
    const [
      allOrders,
      todayOrders,
      allProducts,
      pendingCreditRequests,
      systemConfig
    ] = await Promise.all([
      // All orders for total revenue (filtered by lastSettlementDate if set)
      prisma.order.findMany({
        where: { 
          wholesalerId: wholesalerProfile.id,
          ...(dateFilter ? { createdAt: dateFilter } : {})
        },
        include: {
          retailerProfile: {
            include: { user: true }
          }
        }
      }),
      // Today's orders
      prisma.order.findMany({
        where: {
          wholesalerId: wholesalerProfile.id,
          createdAt: {
            gte: today,
            lt: tomorrow
          }
        }
      }),
      // All products for inventory value
      prisma.product.findMany({
        where: { wholesalerId: wholesalerProfile.id }
      }),
      // Pending credit requests
      prisma.creditRequest.findMany({
        where: {
          retailerProfile: {
            orders: {
              some: {
                wholesalerId: wholesalerProfile.id
              }
            }
          },
          status: 'pending'
        }
      }),
      prisma.systemConfig.findFirst()
    ]);

    const wholesalerMarkupPct = (systemConfig as any)?.wholesalerMarkup || 20;

    // Calculate today's stats (excluding cancelled or rejected orders)
    const activeTodayOrders = todayOrders.filter(o => o.status !== 'cancelled' && o.status !== 'rejected');
    const todayOrdersCount = activeTodayOrders.length;
    const todaySalesAmount = activeTodayOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    // Calculate total revenue (only delivered orders)
    const totalRevenue = allOrders.filter(o => o.status === 'delivered').reduce((sum, order) => sum + order.totalAmount, 0);

    // Calculate inventory values
    const inventoryValueWallet = allProducts.reduce((sum, p) =>
      sum + (p.stock * (p.supplierCost !== null && p.supplierCost !== undefined && p.supplierCost > 0 ? p.supplierCost : (p.costPrice || 0))), 0
    );

    const stockValueWholesaler = allProducts.reduce((sum, p) =>
      sum + (p.stock * (p.price === 0 ? (p.supplierCost !== null && p.supplierCost !== undefined && p.supplierCost > 0 ? p.supplierCost : (p.costPrice || 0)) : p.price)), 0
    );

    // Count pending orders (not limited by settlement date so they don't disappear)
    const pendingOrdersCount = await prisma.order.count({
      where: { wholesalerId: wholesalerProfile.id, status: 'pending' }
    });

    // Count pending credit requests
    const pendingCreditRequestsCount = pendingCreditRequests.length;

    // Get dates for 7-day trend
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      return d;
    }).reverse();

    // Fetch order items for top products (filtered by lastSettlementDate if set)
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: { 
          wholesalerId: wholesalerProfile.id,
          ...(dateFilter ? { createdAt: dateFilter } : {})
        }
      },
      include: { product: true }
    });

    // Calculate profit wallet (realized profit from confirmed sales/revenue)
    const confirmedOrderItems = orderItems.filter(item => {
      const order = allOrders.find(o => o.id === item.orderId);
      return order && ['confirmed', 'shipped', 'delivered'].includes(order.status);
    });
    const profitWallet = confirmedOrderItems.reduce((sum, item) => {
      const rawCost = item.product.supplierCost !== null && item.product.supplierCost !== undefined && item.product.supplierCost > 0
        ? item.product.supplierCost
        : (item.product.costPrice || 0);
      const cost = rawCost > 0 ? rawCost : item.price / (1 + wholesalerMarkupPct / 100);
      return sum + (item.quantity * (item.price - cost));
    }, 0);

    // Calculate top products
    const productStatsMap: Record<string, { name: string; quantity: number; revenue: number }> = {};
    orderItems.forEach(item => {
      const productId = item.productId;
      if (!productStatsMap[productId]) {
        productStatsMap[productId] = { name: item.product.name, quantity: 0, revenue: 0 };
      }
      productStatsMap[productId].quantity += item.quantity;
      productStatsMap[productId].revenue += item.quantity * item.price;
    });

    const topSellingProducts = Object.values(productStatsMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Calculate revenue trend (only delivered orders)
    const revenueTrend = last7Days.map(date => {
      const dateStr = date.toISOString().split('T')[0];
      const amount = allOrders
        .filter(o => o.status === 'delivered' && o.createdAt.toISOString().split('T')[0] === dateStr)
        .reduce((sum, o) => sum + o.totalAmount, 0);
      return { date: dateStr, amount };
    });

    // Calculate top buyers (retailers)
    const retailerStatsMap: Record<string, { name: string; orders: number; revenue: number }> = {};
    allOrders.forEach(order => {
      const retailerId = order.retailerId;
      if (!retailerStatsMap[retailerId]) {
        const name = order.retailerProfile.shopName || order.retailerProfile.user.name || `Retailer ${retailerId}`;
        retailerStatsMap[retailerId] = { name, orders: 0, revenue: 0 };
      }
      retailerStatsMap[retailerId].orders += 1;
      retailerStatsMap[retailerId].revenue += order.totalAmount;
    });

    const topBuyers = Object.values(retailerStatsMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Count unique retailers
    const activeRetailersCount = new Set(allOrders.map(o => o.retailerId)).size;

    const stats = {
      todayDate: today.toISOString().split('T')[0],
      todaySalesAmount: todaySalesAmount,
      todayOrdersCount: todayOrdersCount,
      totalRevenue: totalRevenue,
      inventoryValueWallet: inventoryValueWallet,
      profitWallet: profitWallet,
      pendingOrdersCount: pendingOrdersCount,
      pendingCreditRequestsCount: pendingCreditRequestsCount,

      // Frontend compatibility mappings
      todaysOrders: todayOrdersCount,
      todaysRevenue: todaySalesAmount,
      inventoryValueSupplierCost: inventoryValueWallet,
      pendingOrders: pendingOrdersCount,
      pendingCreditRequests: pendingCreditRequestsCount,

      // Richer stats for Analytics
      totalOrders: allOrders.length,
      totalProducts: allProducts.length,
      stockValueWholesaler: stockValueWholesaler,
      activeRetailers: activeRetailersCount,
      revenueTrend,
      topSellingProducts,
      topBuyers,
      lowStockItems: allProducts.filter(p => p.lowStockThreshold && p.stock <= p.lowStockThreshold).length
    };

    console.log('✅ Dashboard stats calculated:', stats);
    res.json(stats);

  } catch (error: any) {
    console.error('❌ Error fetching dashboard stats:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get inventory with filters, pagination, and search
export const getInventory = async (req: AuthRequest, res: Response) => {
  try {
    console.log('📦 Fetching inventory for user:', req.user?.id);
    console.log('📦 Query params:', req.query);

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      console.error('❌ Wholesaler profile not found');
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    // Extract query parameters
    const {
      category,
      search,
      low_stock,
      limit = '20',
      offset = '0'
    } = req.query;

    // Build where clause
    const where: any = {
      wholesalerId: wholesalerProfile.id,
      retailerId: null  // Never show retailer-owned products in wholesaler inventory
    };

    if (category) {
      where.category = category as string;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { sku: { contains: search as string } },
        { description: { contains: search as string } }
      ];
    }

    if (low_stock === 'true') {
      where.AND = [
        { stock: { gt: 0 } },
        { lowStockThreshold: { not: null } }
      ];
    }

    // Get total count
    const total = await prisma.product.count({ where });

    // Get products with pagination
    let products = await prisma.product.findMany({
      where,
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      orderBy: { createdAt: 'desc' }
    });

    // Filter low stock products if needed
    if (low_stock === 'true') {
      products = products.filter(p =>
        p.lowStockThreshold && p.stock <= p.lowStockThreshold
      );
    }

    console.log(`✅ Found ${products.length} products (total: ${total})`);

    res.json({
      products,
      count: products.length,
      total
    });
  } catch (error: any) {
    console.error('❌ Error fetching inventory:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get inventory statistics
export const getInventoryStats = async (req: AuthRequest, res: Response) => {
  try {
    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    // Auto-correct any products with price = 0
    const zeroPriceProducts = await prisma.product.findMany({
      where: {
        wholesalerId: wholesalerProfile.id,
        price: 0
      }
    });

    if (zeroPriceProducts.length > 0) {
      const config = await prisma.systemConfig.findFirst();
      const wholesalerMarkupPct = (config as any)?.wholesalerMarkup || 20;
      const exciseDutyRatePct = (config as any)?.exciseDutyRate || 10;

      for (const p of zeroPriceProducts) {
        const cost = p.supplierCost !== null && p.supplierCost !== undefined && p.supplierCost > 0 ? p.supplierCost : (p.costPrice || 0);
        if (cost > 0) {
          const pricingResult = calculateWholesalePrice(
            cost,
            wholesalerMarkupPct,
            p.taxType || 'B',
            exciseDutyRatePct
          );
          await prisma.product.update({
            where: { id: p.id },
            data: { price: pricingResult.finalInvoicePrice }
          });
        }
      }
    }

    const products = await prisma.product.findMany({
      where: { wholesalerId: wholesalerProfile.id }
    });

    // Calculate statistics
    const totalProducts = products.length;
    const stockValueSupplier = products.reduce((sum, p) =>
      sum + (p.stock * (p.supplierCost !== null && p.supplierCost !== undefined && p.supplierCost > 0 ? p.supplierCost : (p.costPrice || 0))), 0
    );
    const stockValueWholesaler = products.reduce((sum, p) =>
      sum + (p.stock * (p.price === 0 ? (p.supplierCost !== null && p.supplierCost !== undefined && p.supplierCost > 0 ? p.supplierCost : (p.costPrice || 0)) : p.price)), 0
    );
    const stockProfitMargin = stockValueWholesaler - stockValueSupplier;
    const lowStockCount = products.filter(p => p.lowStockThreshold && p.stock > 0 && p.stock <= p.lowStockThreshold).length;
    const outOfStockCount = products.filter(p => p.stock === 0).length;

    // Calculate realized profit (profit wallet) from confirmed sales/revenue
    const dateFilter = wholesalerProfile.lastSettlementDate ? { gte: wholesalerProfile.lastSettlementDate } : undefined;
    const systemConfig = await prisma.systemConfig.findFirst();
    const wholesalerMarkupPct = (systemConfig as any)?.wholesalerMarkup || 20;

    const orders = await prisma.order.findMany({
      where: { 
        wholesalerId: wholesalerProfile.id,
        ...(dateFilter ? { createdAt: dateFilter } : {})
      }
    });
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: { 
          wholesalerId: wholesalerProfile.id,
          ...(dateFilter ? { createdAt: dateFilter } : {})
        }
      },
      include: { product: true }
    });
    const confirmedOrderItems = orderItems.filter(item => {
      const order = orders.find(o => o.id === item.orderId);
      return order && ['confirmed', 'shipped', 'delivered'].includes(order.status);
    });
    const realizedProfit = confirmedOrderItems.reduce((sum, item) => {
      const rawCost = item.product.supplierCost !== null && item.product.supplierCost !== undefined && item.product.supplierCost > 0
        ? item.product.supplierCost
        : (item.product.costPrice || 0);
      const cost = rawCost > 0 ? rawCost : item.price / (1 + wholesalerMarkupPct / 100);
      return sum + (item.quantity * (item.price - cost));
    }, 0);

    res.json({
      totalProducts,
      stockValueSupplier,
      stockValueWholesaler,
      stockProfitMargin,
      lowStockCount,
      outOfStockCount,
      realizedProfit
    });
  } catch (error: any) {
    console.error('❌ Error fetching inventory stats:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get categories (from global Category table for Add/Edit forms)
export const getCategories = async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });

    res.json({ categories: categories.map(c => c.name) });
  } catch (error: any) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({ error: error.message });
  }
};

// Create product
export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    console.log('📦 Creating product for user:', req.user?.id);
    console.log('📦 Request body:', req.body);

    // Validate user authentication
    if (!req.user || !req.user.id) {
      console.error('❌ User not authenticated');
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!wholesalerProfile) {
      console.error('❌ Wholesaler profile not found for user:', req.user.id);
      return res.status(404).json({
        error: 'Wholesaler profile not found',
        details: 'Please ensure you are logged in as a wholesaler'
      });
    }

    console.log('✅ Wholesaler profile found:', wholesalerProfile.id);

    // Extract fields from request body (matching frontend field names)
    const {
      name,
      description,
      sku,
      category,
      wholesale_price,  // Frontend sends wholesale_price
      cost_price,       // Frontend sends cost_price
      stock,
      unit,
      low_stock_threshold,
      invoice_number,
      barcode,
      image,            // Base64 string from frontend
      taxType,
      supplierCost,
      baseUnit,
      purchaseUnit,
      conversionFactor,
      costPerPurchaseUnit
    } = req.body;

    // Validate required fields
    if (!name || !category || !barcode || (!supplierCost && !costPerPurchaseUnit)) {
      console.error('❌ Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['name', 'category', 'barcode', 'supplierCost or costPerPurchaseUnit'],
        received: { name, category, barcode, supplierCost, costPerPurchaseUnit }
      });
    }

    // Validate or auto-generate SKU
    let finalSku = sku;
    if (!finalSku || finalSku.trim() === '') {
      finalSku = `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    } else {
      finalSku = finalSku.trim();
    }

    // Validate SKU uniqueness globally
    const duplicateSku = await prisma.product.findFirst({
      where: { sku: finalSku }
    });
    if (duplicateSku) {
      console.error('❌ Duplicate SKU:', finalSku);
      return res.status(400).json({
        error: 'A product with this SKU already exists. SKU must be unique globally.'
      });
    }

    // Validate barcode uniqueness
    if (barcode) {
      const duplicateBarcode = await prisma.product.findFirst({
        where: { barcode: barcode.trim() }
      });
      if (duplicateBarcode) {
        console.error('❌ Duplicate barcode:', barcode);
        return res.status(400).json({
          error: 'A product with this barcode already exists in the platform.'
        });
      }
    }

    // Validate wholesale_price is a valid number if provided (legacy support)
    const parsedPrice = wholesale_price ? parseFloat(wholesale_price) : 0;
    if (wholesale_price && (isNaN(parsedPrice) || parsedPrice < 0)) {
      console.error('❌ Invalid wholesale_price:', wholesale_price);
      return res.status(400).json({
        error: 'Invalid wholesale price',
        details: 'Wholesale price must be a positive number'
      });
    }

    // Parse optional cost_price (kept for legacy support, but supplierCost is primary)
    const parsedCostPrice = cost_price ? parseFloat(cost_price) : undefined;
    if (cost_price && (isNaN(parsedCostPrice!) || parsedCostPrice! < 0)) {
      console.error('❌ Invalid cost_price:', cost_price);
      return res.status(400).json({
        error: 'Invalid cost price',
        details: 'Cost price must be a positive number'
      });
    }

    // Validate taxType
    const validTaxTypes = ['A', 'B', 'C', 'D'];
    const parsedTaxType = taxType && validTaxTypes.includes(taxType) ? taxType : 'B';

    const parsedConversion = conversionFactor ? parseFloat(conversionFactor) : null;
    const parsedCostPerPurchaseUnit = costPerPurchaseUnit ? parseFloat(costPerPurchaseUnit) : undefined;
    
    let parsedSupplierCost = supplierCost ? parseFloat(supplierCost) : undefined;
    if (parsedCostPerPurchaseUnit !== undefined && parsedConversion && parsedConversion > 0) {
      parsedSupplierCost = parsedCostPerPurchaseUnit / parsedConversion;
    }

    if (parsedSupplierCost !== undefined && (isNaN(parsedSupplierCost) || parsedSupplierCost < 0)) {
      console.error('❌ Invalid supplierCost / costPerPurchaseUnit:', { supplierCost, costPerPurchaseUnit });
      return res.status(400).json({
        error: 'Invalid cost input',
        details: 'Supplier cost or Cost per Purchase Unit must be a positive number'
      });
    }

    // Parse stock
    let parsedStock = stock ? parseFloat(stock) : 0;
    if (stock && (isNaN(parsedStock) || parsedStock < 0)) {
      console.error('❌ Invalid stock:', stock);
      return res.status(400).json({
        error: 'Invalid stock',
        details: 'Stock must be a non-negative number'
      });
    }

    // Parse optional low_stock_threshold
    const parsedLowStockThreshold = low_stock_threshold ? parseInt(low_stock_threshold) : undefined;
    if (low_stock_threshold && (isNaN(parsedLowStockThreshold!) || parsedLowStockThreshold! < 0)) {
      console.error('❌ Invalid low_stock_threshold:', low_stock_threshold);
      return res.status(400).json({
        error: 'Invalid low stock threshold',
        details: 'Low stock threshold must be a non-negative integer'
      });
    }

    // Fetch SystemConfig for pricing pipeline
    const config = await prisma.systemConfig.findFirst();
    const wholesalerMarkupPct = (config as any)?.wholesalerMarkup || 20;
    const exciseDutyRatePct = (config as any)?.exciseDutyRate || 10;

    // Apply Module 2 Pricing Pipeline if supplierCost is present
    let finalCalculatedPrice = parsedPrice;
    if (parsedSupplierCost !== undefined) {
      const pricingResult = calculateWholesalePrice(
        parsedSupplierCost,
        wholesalerMarkupPct,
        parsedTaxType,
        exciseDutyRatePct
      );
      finalCalculatedPrice = pricingResult.finalInvoicePrice;
    }

    console.log('📦 Creating product with data:', {
      name,
      description,
      sku: finalSku,
      category,
      price: finalCalculatedPrice,
      costPrice: parsedCostPrice,
      stock: parsedStock,
      unit,
      lowStockThreshold: parsedLowStockThreshold,
      invoiceNumber: invoice_number,
      barcode,
      wholesalerId: wholesalerProfile.id,
      image: image || null
    });

    // Upload to Cloudinary if image is provided as base64
    let imageUrl = image;
    if (image && image.startsWith('data:image')) {
      console.log('🖼️ Uploading image to Cloudinary...');
      imageUrl = await uploadImage(image);
      console.log('✅ Image uploaded:', imageUrl);
    }

    const product = await prisma.product.create({
      data: {
        name,
        description,
        sku: finalSku,
        category,
        price: finalCalculatedPrice,  // Overridden by Module 2 Pricing Pipeline
        costPrice: parsedCostPrice,   // Store cost_price as costPrice
        stock: parsedStock,
        unit,
        lowStockThreshold: parsedLowStockThreshold,
        invoiceNumber: invoice_number,
        barcode,
        wholesalerId: wholesalerProfile.id,
        image: imageUrl || null,
        taxType: parsedTaxType,
        supplierCost: parsedSupplierCost,
        baseUnit: baseUnit || null,
        purchaseUnit: purchaseUnit || null,
        conversionFactor: parsedConversion
      } as any
    });

    console.log('✅ Product created successfully:', product.id);
    res.json({ success: true, product });
  } catch (error: any) {
    console.error('❌ Error creating product:', error);
    res.status(500).json({
      error: error.message,
      details: 'An unexpected error occurred while creating the product'
    });
  }
};

// Update product (general info)
export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      category, 
      sku, 
      unit, 
      low_stock_threshold, 
      invoice_number, 
      barcode, 
      description, 
      image,
      baseUnit,
      purchaseUnit,
      conversionFactor,
      costPerPurchaseUnit,
      supplierCost,
      taxType,
      wholesale_price
    } = req.body;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user?.id }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    const currentProduct = await prisma.product.findUnique({
      where: { id: Number(id), wholesalerId: wholesalerProfile.id }
    });

    if (!currentProduct) {
      return res.status(404).json({ error: 'Product not found or not owned by wholesaler' });
    }

    // Upload to Cloudinary if new image is provided
    let imageUrl = image;
    if (image && image.startsWith('data:image')) {
      console.log('🖼️ Uploading new image to Cloudinary...');
      imageUrl = await uploadImage(image);
      console.log('✅ New image uploaded:', imageUrl);
    }

    // Validate barcode uniqueness
    if (barcode) {
      const duplicateBarcode = await prisma.product.findFirst({
        where: {
          barcode: barcode.trim(),
          id: { not: Number(id) }
        }
      });
      if (duplicateBarcode) {
        return res.status(400).json({
          error: 'A product with this barcode already exists in the platform.'
        });
      }
    }

    const parsedConversion = conversionFactor !== undefined ? (conversionFactor ? parseFloat(conversionFactor) : null) : (currentProduct as any).conversionFactor;
    const parsedCostPerPurchaseUnit = costPerPurchaseUnit !== undefined ? parseFloat(costPerPurchaseUnit) : undefined;
    
    let parsedSupplierCost = supplierCost !== undefined ? parseFloat(supplierCost) : undefined;
    if (parsedCostPerPurchaseUnit !== undefined && parsedConversion && parsedConversion > 0) {
      parsedSupplierCost = parsedCostPerPurchaseUnit / parsedConversion;
    }

    let finalCalculatedPrice = wholesale_price ? parseFloat(wholesale_price) : undefined;
    if (parsedSupplierCost !== undefined) {
      const resolvedTaxType = taxType || (currentProduct as any).taxType || 'B';
      const config = await prisma.systemConfig.findFirst();
      const wholesalerMarkupPct = (config as any)?.wholesalerMarkup || 20;
      const exciseDutyRatePct = (config as any)?.exciseDutyRate || 10;

      const pricingResult = calculateWholesalePrice(
        parsedSupplierCost,
        wholesalerMarkupPct,
        resolvedTaxType,
        exciseDutyRatePct
      );
      finalCalculatedPrice = pricingResult.finalInvoicePrice;
    }

    const product = await prisma.product.update({
      where: {
        id: Number(id),
        wholesalerId: wholesalerProfile.id // Ensure ownership
      },
      data: {
        name,
        category,
        sku,
        unit,
        lowStockThreshold: low_stock_threshold ? parseInt(low_stock_threshold) : undefined,
        invoiceNumber: invoice_number,
        barcode,
        description,
        image: imageUrl,
        price: finalCalculatedPrice,
        supplierCost: parsedSupplierCost,
        baseUnit: baseUnit !== undefined ? (baseUnit || null) : undefined,
        purchaseUnit: purchaseUnit !== undefined ? (purchaseUnit || null) : undefined,
        conversionFactor: parsedConversion
      } as any
    });

    res.json({ success: true, product });
  } catch (error: any) {
    console.error('❌ Error updating product:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update stock
export const updateStock = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { quantity, type, reason } = req.body; // type: 'add', 'remove', 'set'

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user?.id }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    const currentProduct = await prisma.product.findUnique({
      where: { id: Number(id), wholesalerId: wholesalerProfile.id }
    });

    if (!currentProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    let newStock = currentProduct.stock;
    const amount = parseInt(quantity);

    if (type === 'add') newStock += amount;
    else if (type === 'remove') newStock = Math.max(0, newStock - amount);
    else if (type === 'set') newStock = amount;

    const product = await prisma.product.update({
      where: { id: Number(id) },
      data: { stock: newStock }
    });

    // TODO: Log stock transaction/history if needed

    res.json({ success: true, product });
  } catch (error: any) {
    console.error('❌ Error updating stock:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update price
export const updatePrice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { wholesale_price, cost_price } = req.body;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user?.id }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    const currentProduct = await prisma.product.findUnique({
      where: { id: Number(id), wholesalerId: wholesalerProfile.id }
    });

    if (!currentProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const parsedCost = cost_price ? parseFloat(cost_price) : undefined;
    let finalCalculatedPrice = wholesale_price ? parseFloat(wholesale_price) : undefined;

    if (parsedCost !== undefined) {
      const resolvedTaxType = currentProduct.taxType || 'B';
      const config = await prisma.systemConfig.findFirst();
      const wholesalerMarkupPct = (config as any)?.wholesalerMarkup || 20;
      const exciseDutyRatePct = (config as any)?.exciseDutyRate || 10;

      const pricingResult = calculateWholesalePrice(
        parsedCost,
        wholesalerMarkupPct,
        resolvedTaxType,
        exciseDutyRatePct
      );
      finalCalculatedPrice = pricingResult.finalInvoicePrice;
    }

    const product = await prisma.product.update({
      where: { id: Number(id), wholesalerId: wholesalerProfile.id },
      data: {
        price: finalCalculatedPrice,
        costPrice: parsedCost,
        supplierCost: parsedCost
      }
    });

    res.json({ success: true, product });
  } catch (error: any) {
    console.error('❌ Error updating price:', error);
    res.status(500).json({ error: error.message });
  }
};

// Delete product
export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user?.id }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    await prisma.product.delete({
      where: { id: Number(id), wholesalerId: wholesalerProfile.id }
    });

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error: any) {
    console.error('❌ Error deleting product:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get retailer orders
export const getRetailerOrders = async (req: AuthRequest, res: Response) => {
  try {
    console.log('📋 Fetching orders for user:', req.user?.id);

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      console.error('❌ Wholesaler profile not found');
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    const orders = await prisma.order.findMany({
      where: { wholesalerId: wholesalerProfile.id },
      include: {
        orderItems: {
          include: { product: true }
        },
        retailerProfile: {
          include: { user: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`✅ Found ${orders.length} orders`);
    res.json({ orders, count: orders.length });
  } catch (error: any) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get single order with details
export const getOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    console.log('📋 Fetching order details for:', id);

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    const order = await prisma.order.findUnique({
      where: {
        id: Number(id),
        wholesalerId: wholesalerProfile.id
      },
      include: {
        orderItems: {
          include: { product: true }
        },
        retailerProfile: {
          include: { user: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ order });
  } catch (error: any) {
    console.error('❌ Error fetching order details:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update order status
export const updateOrderStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes, rejectionReason, cancellationReason } = req.body;

    const currentOrder = await prisma.order.findUnique({ where: { id: Number(id) } });
    if (!currentOrder) return res.status(404).json({ error: 'Order not found' });

    // State machine: pending -> confirmed (PROCEED) -> shipped -> delivered
    const validTransitions: Record<string, string[]> = {
      'pending': ['confirmed', 'cancelled', 'rejected'],
      'confirmed': ['shipped', 'cancelled', 'rejected'],
      'shipped': ['delivered'],
      'delivered': [],
      'cancelled': [],
      'rejected': []
    };

    if (!validTransitions[currentOrder.status]?.includes(status)) {
      return res.status(400).json({
        error: `Invalid status transition from ${currentOrder.status} to ${status}`
      });
    }

    const updateData: any = { status };
    if (notes) updateData.notes = notes;
    if (rejectionReason) updateData.rejectionReason = rejectionReason;
    if (cancellationReason) updateData.cancellationReason = cancellationReason;

    const order = await prisma.order.update({
      where: { id: Number(id) },
      data: updateData
    });

    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get order statistics
export const getOrderStats = async (req: AuthRequest, res: Response) => {
  try {
    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [allOrders, todayOrders] = await Promise.all([
      prisma.order.findMany({
        where: { wholesalerId: wholesalerProfile.id }
      }),
      prisma.order.findMany({
        where: {
          wholesalerId: wholesalerProfile.id,
          createdAt: { gte: today, lt: tomorrow }
        }
      })
    ]);

    const stats = {
      total_orders: allOrders.length,
      pending_orders: allOrders.filter(o => o.status === 'pending').length,
      confirmed_orders: allOrders.filter(o => o.status === 'confirmed').length,
      processing_orders: allOrders.filter(o => o.status === 'processing').length,
      shipped_orders: allOrders.filter(o => o.status === 'shipped').length,
      delivered_orders: allOrders.filter(o => o.status === 'delivered').length,
      cancelled_orders: allOrders.filter(o => o.status === 'cancelled').length,
      rejected_orders: allOrders.filter(o => o.status === 'rejected').length,
      total_revenue: allOrders.filter(o => o.status === 'delivered').reduce((sum, o) => sum + o.totalAmount, 0),
      today_orders: todayOrders.length,
      today_revenue: todayOrders.reduce((sum, o) => sum + o.totalAmount, 0)
    };

    res.json({ stats });
  } catch (error: any) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({ error: error.message });
  }
};

// Confirm a pending order
export const confirmOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const order = await prisma.order.findUnique({
      where: { id: Number(id) }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.wholesalerId !== wholesalerProfile.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized to confirm this order' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot confirm order with status: ${order.status}` });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Get order items with product info
      const orderWithItems = await tx.order.findUnique({
        where: { id: Number(id) },
        include: { orderItems: { include: { product: true } } }
      });

      if (!orderWithItems) throw new Error('Order not found');

      // 2. Check and decrement stock for each item
      for (const item of orderWithItems.orderItems) {
        if (!item.product) throw new Error(`Product not found for item ${item.productId}`);

        if (item.product.stock < item.quantity) {
          throw new Error(`Insufficient stock for product: ${item.product.name}. Available: ${item.product.stock}, Required: ${item.quantity}`);
        }

        // Decrement wholesaler's stock
        const updatedProduct = await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        });

        // Trigger Wholesaler Low/Out of Stock Alert (WHO-EMAIL-013/014)
        if (wholesalerProfile.user?.email) {
          const threshold = updatedProduct.lowStockThreshold || 10;
          if (updatedProduct.stock <= 0) {
            await emailQueue.add('wholesaler-out-of-stock-alert', {
              to: wholesalerProfile.user.email,
              templateType: 'wholesaler-out-of-stock', // Mapped to WHO-EMAIL-014
              data: {
                wholesaler_name: wholesalerProfile.companyName,
                product: updatedProduct.name,
                restock_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/wholesaler/inventory`
              },
              relatedEntity: { type: 'PRODUCT', id: updatedProduct.id.toString() }
            });
          } else if (updatedProduct.stock <= threshold) {
            await emailQueue.add('wholesaler-low-stock-alert', {
              to: wholesalerProfile.user.email,
              templateType: 'wholesaler-low-stock', // Mapped to WHO-EMAIL-013
              data: {
                wholesaler_name: wholesalerProfile.companyName,
                product: updatedProduct.name,
                remaining_quantity: updatedProduct.stock,
                minimum_required: threshold,
                restock_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/wholesaler/inventory`
              },
              relatedEntity: { type: 'PRODUCT', id: updatedProduct.id.toString() }
            });
          }
        }
      }

      // 3. Update order status
      const updatedOrder = await tx.order.update({
        where: { id: Number(id) },
        data: { status: 'confirmed' },
        include: {
          orderItems: { include: { product: true } },
          retailerProfile: { include: { user: true } }
        }
      });

      // 4. Trigger Email Notification (RET-EMAIL-002)
      const orderDate = updatedOrder.createdAt.toLocaleDateString();
      const estDelivery = new Date(updatedOrder.createdAt.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString(); // 24h default

      await emailQueue.add('order-accepted', {
        to: updatedOrder.retailerProfile.user.email,
        templateType: 'order-accepted',
        data: {
          order_id: updatedOrder.id.toString(),
          retail_name: updatedOrder.retailerProfile.shopName,
          product: updatedOrder.orderItems.map(item => `${item.quantity}x ${item.product.name}`).join(', '),
          quantity: updatedOrder.orderItems.reduce((sum, item) => sum + item.quantity, 0).toString(),
          wholesaler_name: wholesalerProfile.companyName,
          order_date: orderDate,
          estimated_delivery: estDelivery
        },
        relatedEntity: { type: 'ORDER', id: updatedOrder.id.toString() }
      });

      return updatedOrder;
    }, { timeout: 15000 });

    res.json({ success: true, order: result, message: 'Order confirmed and stock deducted successfully' });
  } catch (error: any) {
    console.error('Error confirming order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject an order with reason
export const rejectOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const order = await prisma.order.findUnique({
      where: { id: Number(id) }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.wholesalerId !== wholesalerProfile.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized to reject this order' });
    }

    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ success: false, error: `Cannot reject order with status: ${order.status}` });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: Number(id) },
      data: {
        status: 'rejected',
        rejectionReason: reason || 'N/A'
      } as any,
      include: {
        orderItems: { include: { product: true } },
        retailerProfile: { include: { user: true } }
      }
    });

    res.json({ success: true, order: updatedOrder, message: 'Order rejected successfully' });
  } catch (error: any) {
    console.error('Error rejecting order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Ship an order with tracking info
export const shipOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const shipperName = req.body.shipperName || req.body.shipper_name;
    const shipperPhone = req.body.shipperPhone || req.body.shipper_phone;
    const vehiclePlate = req.body.vehiclePlate || req.body.vehicle_plate;
    const delivery_notes = req.body.delivery_notes || req.body.deliveryNotes;

    // MANDATORY FIELD VALIDATION FOR SHIPPING
    if (!shipperName || !shipperPhone || !vehiclePlate) {
      return res.status(400).json({
        success: false,
        error: 'Mandatory shipping information missing: Shipper Name, Phone, and Vehicle Plate are required.'
      });
    }

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const order = await prisma.order.findUnique({
      where: { id: Number(id) }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.wholesalerId !== wholesalerProfile.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized to ship this order' });
    }

    if (order.status !== 'confirmed') {
      return res.status(400).json({ success: false, error: `Cannot ship order with status: ${order.status}. Order must be proceeded first.` });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: Number(id) },
      data: {
        status: 'shipped',
        shipperName,
        shipperPhone,
        vehiclePlate
      } as any,
      include: {
        orderItems: { include: { product: true } },
        retailerProfile: { include: { user: true } }
      }
    });

    res.json({ success: true, order: updatedOrder, message: 'Order shipped successfully' });
  } catch (error: any) {
    console.error('Error shipping order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Confirm delivery of an order
export const confirmDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const order = await prisma.order.findUnique({
      where: { id: Number(id) }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.wholesalerId !== wholesalerProfile.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized to confirm delivery for this order' });
    }

    if (order.status !== 'shipped') {
      return res.status(400).json({ success: false, error: `Cannot confirm delivery for order with status: ${order.status}. Order must be shipped first.` });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update order status
      const updatedOrder = await tx.order.update({
        where: { id: Number(id) },
        data: { status: 'delivered' },
        include: {
          orderItems: { include: { product: true } },
          retailerProfile: { include: { user: true } }
        }
      });

      // Fetch SystemConfig for Retailer Inheritance Pipeline
      const config = await prisma.systemConfig.findFirst();
      const wholesalerMarkupPct = (config as any)?.wholesalerMarkup || 20;
      const retailerMarkupPct = (config as any)?.retailerMarkup || 20;
      const exciseDutyRatePct = (config as any)?.exciseDutyRate || 10;
      const { calculateRetailPrice } = await import('../utils/pricingUtils');

      // 2. Update Retailer's Inventory
      for (const item of updatedOrder.orderItems) {
        if (!item.product) continue;

        // Search for existing product in retailer's inventory robustly
        // Priority: Barcode > SKU > Name
        let existingProduct = null;

        if (item.product.barcode && item.product.barcode.trim() !== '') {
          existingProduct = await tx.product.findFirst({
            where: {
              retailerId: updatedOrder.retailerId,
              barcode: item.product.barcode,
              status: 'active'
            }
          });
        }

        if (!existingProduct && item.product.sku && item.product.sku.trim() !== '') {
          existingProduct = await tx.product.findFirst({
            where: {
              retailerId: updatedOrder.retailerId,
              sku: item.product.sku,
              status: 'active'
            }
          });
        }

        if (!existingProduct) {
          existingProduct = await tx.product.findFirst({
            where: {
              retailerId: updatedOrder.retailerId,
              name: item.product.name,
              status: 'active'
            }
          });
        }

        if (existingProduct) {
          // Update existing stock and ensure it's active
          const conversionFactor = (existingProduct as any).conversionFactor ? Number((existingProduct as any).conversionFactor) : null;
          let addStock = item.quantity;
          if (conversionFactor && conversionFactor > 0) {
            addStock = item.quantity * conversionFactor;
          }

          await tx.product.update({
            where: { id: existingProduct.id },
            data: { 
              stock: { increment: addStock },
              status: 'active',
              taxType: item.product.taxType || 'B'
            }
          });
        } else {
          // Create new product for retailer based on wholesaler's product

          // Retailer Inheritance Pipeline
          const supplierCost = (item.product as any).supplierCost || item.product.costPrice || 0;
          const cleanBaseCost = supplierCost * (1 + wholesalerMarkupPct / 100);
          const taxType = (item.product as any).taxType || 'B';

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
              image: item.product.image,
              status: 'active',
              taxType: taxType,
              supplierCost: item.product.price              // The actual invoice amount they paid for the stock
            } as any
          });
        }
      }

      // 3. Trigger Email Notification (RET-EMAIL-003)
      const { emailQueue } = await import('../queues/email.queue');
      const deliveryDate = updatedOrder.updatedAt.toLocaleDateString();
      const amountStr = updatedOrder.totalAmount.toLocaleString();

      await emailQueue.add('order-delivered', {
        to: updatedOrder.retailerProfile.user.email,
        templateType: 'order-delivered', // Mapped to RET-EMAIL-003
        data: {
          retail_name: updatedOrder.retailerProfile.shopName,
          order_id: updatedOrder.id.toString(),
          invoice_no: `INV-${updatedOrder.id}`,
          product: updatedOrder.orderItems.map(item => `${item.quantity}x ${item.product.name}`).join(', '),
          quantity: updatedOrder.orderItems.reduce((sum, item) => sum + item.quantity, 0).toString(),
          amount: amountStr,
          delivery_date: deliveryDate,
          payment_method: updatedOrder.paymentMethod || 'Wallet',
          balance: (updatedOrder.retailerProfile.walletBalance || 0).toLocaleString(),
          receipt_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/receipts/${updatedOrder.id}`
        },
        relatedEntity: { type: 'ORDER', id: updatedOrder.id.toString() }
      });

      // 4. Trigger Wholesaler Alert (WHO-EMAIL-004)
      if (wholesalerProfile.user?.email) {
        await emailQueue.add('retailer-order-delivered-alert', {
          to: wholesalerProfile.user.email,
          templateType: 'retailer-order-delivered', // Mapped to WHO-EMAIL-004
          data: {
            wholesaler_name: wholesalerProfile.companyName,
            retail_name: updatedOrder.retailerProfile.shopName,
            order_id: updatedOrder.id.toString(),
            invoice_no: `INV-${updatedOrder.id}`,
            product: updatedOrder.orderItems.length > 1 ? `${updatedOrder.orderItems[0].product.name} and others` : updatedOrder.orderItems[0].product.name,
            quantity: updatedOrder.orderItems.reduce((sum, item) => sum + item.quantity, 0).toString(),
            amount: amountStr,
            delivery_date: deliveryDate,
            payment_method: updatedOrder.paymentMethod || 'Wallet',
            balance: (updatedOrder.retailerProfile.walletBalance || 0).toLocaleString(),
            receipt_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/receipts/${updatedOrder.id}`
          },
          relatedEntity: { type: 'ORDER', id: updatedOrder.id.toString() }
        });
      }

      return updatedOrder;
    }, { timeout: 15000 });

    res.json({ success: true, order: result, message: 'Delivery confirmed and retailer stock updated' });
  } catch (error: any) {
    console.error('Error confirming delivery:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// CREDIT MANAGEMENT
// ==========================================

export const getCreditRequests = async (req: AuthRequest, res: Response) => {
  try {
    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) return res.status(404).json({ error: 'Wholesaler not found' });

    const requests = await prisma.creditRequest.findMany({
      where: {
        retailerProfile: {
          orders: {
            some: { wholesalerId: wholesalerProfile.id }
          }
        }
      },
      include: {
        retailerProfile: {
          include: { user: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ requests });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const approveCreditRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await prisma.$transaction(async (prisma) => {
      const request = await prisma.creditRequest.findUnique({
        where: { id: Number(id) }
      });

      if (!request) throw new Error('Credit request not found');
      if (request.status !== 'pending') throw new Error('Request already processed');

      // 1. Update Request
      await prisma.creditRequest.update({
        where: { id: Number(id) },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewNotes: notes
        }
      });

      // 2. Update Retailer Credit
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

      // 3. Trigger Email Notification (RET-EMAIL-009)
      const { emailQueue } = await import('../queues/email.queue');
      const retailer = await prisma.retailerProfile.findUnique({
        where: { id: request.retailerId },
        include: { user: true }
      });

      if (retailer?.user?.email) {
        await emailQueue.add('credit-request-approved', {
          to: retailer.user.email,
          templateType: 'credit-request-approved',
          data: {
            retail_name: retailer.shopName,
            approved_amount: request.amount.toLocaleString(),
            repayment_period: '30 Days',
            due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
            interest_rate: '5%',
            repayment_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/retailer/credit`
          },
          relatedEntity: { type: 'CREDIT_REQUEST', id: request.id.toString() }
        });
      }

      return { success: true };
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const rejectCreditRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    await prisma.creditRequest.update({
      where: { id: Number(id) },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewNotes: notes
      }
    });

    res.json({ success: true, message: 'Credit request rejected' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// LINK REQUEST MANAGEMENT (Retailer-Wholesaler Linking)
// ==========================================

// Get all link requests for this wholesaler
export const getLinkRequests = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const where: any = { wholesalerId: wholesalerProfile.id };
    if (status) {
      where.status = status as string;
    }

    const requests = await prisma.linkRequest.findMany({
      where,
      include: {
        retailer: {
          include: {
            user: {
              select: { phone: true, email: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedRequests = requests.map(r => ({
      id: r.id,
      retailerId: r.retailerId,
      retailerName: r.retailer.shopName,
      retailerPhone: r.retailer.user?.phone,
      retailerEmail: r.retailer.user?.email,
      retailerAddress: r.retailer.address,
      isVerified: r.retailer.isVerified,
      status: r.status,
      message: r.message,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt
    }));

    // Get counts by status
    const pendingCount = requests.filter(r => r.status === 'pending').length;
    const approvedCount = requests.filter(r => r.status === 'approved').length;
    const rejectedCount = requests.filter(r => r.status === 'rejected').length;

    res.json({
      success: true,
      requests: formattedRequests,
      stats: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        total: requests.length
      }
    });
  } catch (error: any) {
    console.error('Error fetching link requests:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Approve a link request
export const approveLinkRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const request = await prisma.linkRequest.findFirst({
      where: {
        id: parseInt(requestId),
        wholesalerId: wholesalerProfile.id
      },
      include: { retailer: { include: { user: true } } }
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Link request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Request already ${request.status}`
      });
    }

    // NEW: Retailer can be linked to MULTIPLE wholesalers
    // No need to check if already linked elsewhere - just approve this request
    // The LinkRequest table tracks per-wholesaler approval status

    // Update request status to approved
    await prisma.linkRequest.update({
      where: { id: request.id },
      data: {
        status: 'approved',
        respondedAt: new Date()
      }
    });

    // Trigger Email Notification (RET-EMAIL-005)
    const { emailQueue } = await import('../queues/email.queue');
    if (request.retailer.user?.email) {
      await emailQueue.add('link-request-approved', {
        to: request.retailer.user.email,
        templateType: 'link-request-approved',
        data: {
          retail_name: request.retailer.shopName,
          customer_name: wholesalerProfile.companyName, // In this context, the wholesaler is the "partner"
          approval_date: new Date().toLocaleDateString()
        },
        relatedEntity: { type: 'LINK_REQUEST', id: request.id.toString() }
      });
    }

    res.json({
      success: true,
      message: `Link request approved. ${request.retailer.shopName} is now linked to you.`
    });
  } catch (error: any) {
    console.error('Error approving link request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject a link request
export const rejectLinkRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const request = await prisma.linkRequest.findFirst({
      where: {
        id: parseInt(requestId),
        wholesalerId: wholesalerProfile.id,
        status: 'pending'
      }
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Pending link request not found' });
    }

    await prisma.linkRequest.update({
      where: { id: request.id },
      data: {
        status: 'rejected',
        rejectionReason: reason || null,
        respondedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Link request rejected'
    });
  } catch (error: any) {
    console.error('Error rejecting link request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get linked retailers for this wholesaler
// NEW: Uses LinkRequest table to check approved retailers (supports multiple retailers)
export const getLinkedRetailers = async (req: AuthRequest, res: Response) => {
  try {
    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    // Get ALL linked retailers using BOTH methods:
    // 1. Via LinkRequest table (new method) - status = 'approved'
    // 2. Via linkedWholesalerId field (old method) - for backwards compatibility

    // Method 1: Get retailers from approved LinkRequest entries
    const approvedRequests = await prisma.linkRequest.findMany({
      where: {
        wholesalerId: wholesalerProfile.id,
        status: 'approved'
      },
      include: {
        retailer: {
          include: {
            user: {
              select: { phone: true, email: true }
            },
            orders: {
              where: { wholesalerId: wholesalerProfile.id },
              select: { id: true, totalAmount: true }
            }
          }
        }
      }
    });

    // Method 2: Get retailers with linkedWholesalerId set (old method)
    const directlyLinkedRetailers = await prisma.retailerProfile.findMany({
      where: {
        linkedWholesalerId: wholesalerProfile.id
      },
      include: {
        user: {
          select: { phone: true, email: true }
        },
        orders: {
          where: { wholesalerId: wholesalerProfile.id },
          select: { id: true, totalAmount: true }
        }
      }
    });

    // Combine both lists and remove duplicates
    const retailerIdsFromRequests = new Set(approvedRequests.map(req => req.retailer.id));

    const formattedFromRequests = approvedRequests.map(req => ({
      id: req.retailer.id,
      shopName: req.retailer.shopName,
      address: req.retailer.address,
      phone: req.retailer.user?.phone,
      email: req.retailer.user?.email,
      isVerified: req.retailer.isVerified,
      linkedAt: req.respondedAt || req.updatedAt,
      orderCount: req.retailer.orders.length,
      totalPurchased: req.retailer.orders.reduce((sum, o) => sum + o.totalAmount, 0),
      linkMethod: 'request'
    }));

    const formattedFromDirect = directlyLinkedRetailers
      .filter(r => !retailerIdsFromRequests.has(r.id)) // Avoid duplicates
      .map(r => ({
        id: r.id,
        shopName: r.shopName,
        address: r.address,
        phone: r.user?.phone,
        email: r.user?.email,
        isVerified: r.isVerified,
        linkedAt: r.updatedAt,
        orderCount: r.orders.length,
        totalPurchased: r.orders.reduce((sum, o) => sum + o.totalAmount, 0),
        linkMethod: 'direct'
      }));

    const allRetailers = [...formattedFromRequests, ...formattedFromDirect];

    console.log(`Wholesaler ${wholesalerProfile.id}: Found ${approvedRequests.length} from LinkRequest, ${directlyLinkedRetailers.length} from direct link, ${allRetailers.length} total unique`);

    res.json({
      success: true,
      retailers: allRetailers,
      total: allRetailers.length
    });
  } catch (error: any) {
    console.error('Error fetching linked retailers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Unlink a retailer
// NEW: Uses LinkRequest table - updates status to 'rejected' or deletes the request
export const unlinkRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { retailerId } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    // Find the approved link request for this retailer-wholesaler pair
    const linkRequest = await prisma.linkRequest.findUnique({
      where: {
        retailerId_wholesalerId: {
          retailerId: parseInt(retailerId),
          wholesalerId: wholesalerProfile.id
        }
      },
      include: { retailer: true }
    });

    if (!linkRequest) {
      return res.status(404).json({ success: false, error: 'Link request not found' });
    }

    if (linkRequest.status !== 'approved') {
      return res.status(400).json({ success: false, error: 'Retailer is not currently linked to you' });
    }

    // Update link request status to 'unlinked' (or delete it)
    await prisma.linkRequest.update({
      where: { id: linkRequest.id },
      data: {
        status: 'unlinked',
        respondedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: `${linkRequest.retailer.shopName} has been unlinked`
    });
  } catch (error: any) {
    console.error('Error unlinking retailer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// SETTLEMENT INVOICES (Read-only for Wholesaler)
// ==========================================

// Get assigned settlement invoices for this wholesaler
export const getSettlementInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const where: any = {
      wholesalerId: wholesalerProfile.id,
      partyType: 'wholesaler'
    };

    if (month) {
      where.settlementMonth = month as string;
    }

    const invoices = await prisma.settlementInvoice.findMany({
      where,
      orderBy: { settlementMonth: 'desc' }
    });

    res.json({
      success: true,
      invoices,
      total: invoices.length
    });
  } catch (error: any) {
    console.error('Get Settlement Invoices Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single settlement invoice detail
export const getSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ success: false, error: 'Wholesaler profile not found' });
    }

    const invoice = await prisma.settlementInvoice.findFirst({
      where: {
        id: Number(id),
        wholesalerId: wholesalerProfile.id
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

// Generate a unique barcode across the platform
export const generateUniqueBarcode = async (req: AuthRequest, res: Response) => {
  try {
    let isUnique = false;
    let barcode = '';
    let attempts = 0;
    while (!isUnique && attempts < 100) {
      attempts++;
      // Generate a 12-digit random number (e.g. starting with 990 for custom generated codes)
      const randomPart = Math.floor(100000000 + Math.random() * 900000000).toString();
      barcode = `990${randomPart}`;

      const existing = await prisma.product.findFirst({
        where: { barcode }
      });
      if (!existing) {
        isUnique = true;
      }
    }
    if (!isUnique) {
      return res.status(500).json({ error: 'Could not generate a unique barcode' });
    }
    res.json({ barcode });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// PROFIT INVOICES (Wholesaler - Read Only)
// ==========================================
export const getMyProfitInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const wholesalerProfile = await prisma.wholesalerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!wholesalerProfile) {
      return res.status(404).json({ error: 'Wholesaler profile not found' });
    }

    const invoices = await prisma.customProfitInvoice.findMany({
      where: { wholesalerId: wholesalerProfile.id } as any,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: invoices });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};


