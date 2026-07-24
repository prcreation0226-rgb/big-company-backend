# Pricing, FIFO Inventory, and Discount Safeguard Integration Blueprint

This document outlines the detailed system specification, mathematical validation, and architectural changes required to implement the pricing pipeline, FIFO inventory control, tax groups, and sales discount validation gates in the **Big Company** platform.

---

## 1. Module 1: The Master Admin Dashboard (Core Controls)

To ensure centralized business control, only top-level **Administrators** can modify global configuration parameters. Neither wholesalers nor retailers can override these rules.

### Configuration Properties
These settings must be persisted in a database configuration table (e.g., `SystemSetting`) or runtime environment configs:
1. **Global Profit Margin Settings (Markup %)**:
   - `WHOLESALER_MARKUP_PCT` (Decimal): Added directly to the supplier cost.
   - `RETAILER_MARKUP_PCT` (Decimal): Added directly to the inherited pre-tax retailer cost.
2. **Discount Safety Floor**:
   - `MAX_DISCOUNT_PCT` (Decimal): Maximum percentage discount cashiers/sales agents can grant at the POS before the safeguard block is triggered.
3. **The Four Tax Categories**:
   - **Type A (Exempted)**: 0% tax.
   - **Type B (Standard VAT)**: 18% standard VAT rate.
   - **Type C (Zero-Rated)**: 0% tax, but gross taxable amounts are tracked for tax audits.
   - **Type D (Luxury / Excise Duty Included)**: Compounded tax structure:
     1. Apply a specific **Excise Duty rate** (e.g., 10%) on the pre-tax base cost to generate a Taxable Subtotal.
     2. Apply the standard **18% VAT rate** on top of that combined subtotal.

---

## 2. Module 2: The Step-by-Step System Pricing Pipeline

When products are registered and moved down the supply chain, the platform executes a sequential pipeline:

```
┌──────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐      ┌───────────────────────┐
│ Wholesaler Cost  │ ───> │ Wholesale Price (Base) │ ───> │  Retailer Cost (Base)  │ ───> │ Consumer Shelf Price  │
│ (Supplier cost)  │      │ +Markup +Tax (A/B/C/D) │      │  (Strips Type B/D tax) │      │ +Markup +Tax (A/B/C/D)│
└──────────────────┘      └────────────────────────┘      └────────────────────────┘      └───────────────────────┘
```

1. **Wholesaler Intake**: Wholesaler registers a batch with the raw supplier cost and assigns one of the legal tax types (A, B, C, or D).
2. **Wholesale Price Generation**: The system applies the `WHOLESALER_MARKUP_PCT` to the supplier cost to find the pre-tax wholesale price. The system then calculates the designated tax on this pre-tax wholesale price and sums them up.
3. **Retailer Cost Inheritance (Tax Stripping)**: When a retailer buys this stock from a wholesaler, the item is moved to the retailer's inventory. **Crucial Rule**: The system must automatically strip out standard VAT (Type B) and Excise + VAT (Type D) from the wholesale price. The retailer's profit markup is calculated *only* on this clean, pre-tax base cost.
4. **Final Consumer Price Generation**: The system applies the `RETAILER_MARKUP_PCT` to the retailer's clean base cost, calculates the tax on this new pre-tax retailer price, and generates the final consumer shelf price.

### The Banker's Rounding Guardrail
To prevent rounding errors from compounding over thousands of transactions, the system must apply **Banker's Rounding** (round-to-nearest-even) to the nearest whole Rwandan Franc (RWF) at the end of each step. 
* *Example*: `0.5` rounds to `0`, `1.5` rounds to `2`, `2.5` rounds to `2`, `3.5` rounds to `4`.

---

## 3. Module 3: Mathematical Tax Examples (Wholesaler Markup: 20%, Retailer Markup: 20%, Type D Excise: 10%)

### Example 1: Type A (Exempted) & Type C (Zero-Rated)
* **Wholesaler Tier**:
  - Supplier Cost = `1,000 RWF`
  - Pre-Tax Wholesale Price = $1,000 \times 1.20 = 1,200 \text{ RWF}$
  - Tax (0%) = `0 RWF`
  - Final Wholesale Invoice Price = `1,200 RWF`
* **Retailer Tier**:
  - Inherited Base Cost = `1,200 RWF`
  - Pre-Tax Retail Price = $1,200 \times 1.20 = 1,440 \text{ RWF}$
  - Tax (0%) = `0 RWF`
  - Final Consumer Shelf Price = `1,440 RWF`

### Example 2: Type B (Standard 18% VAT)
* **Wholesaler Tier**:
  - Supplier Cost = `1,000 RWF`
  - Pre-Tax Wholesale Price = $1,000 \times 1.20 = 1,200 \text{ RWF}$
  - VAT Amount (18% of 1,200) = $1,200 \times 0.18 = 216 \text{ RWF}$
  - Final Wholesale Invoice Price = $1,200 + 216 = 1,416 \text{ RWF}$
* **Retailer Tier**:
  - Purchased Price = `1,416 RWF`
  - Stripped Base Cost = $1,416 - 216 = 1,200 \text{ RWF}$ (Pre-tax)
  - Pre-Tax Retail Price = $1,200 \times 1.20 = 1,440 \text{ RWF}$
  - VAT Amount (18% of 1,440) = $1,440 \times 0.18 = 259.20 \text{ RWF}$
  - Sum = $1,440 + 259.20 = 1,699.20 \text{ RWF}$
  - Final Consumer Shelf Price (Banker's Rounded) = `1,699 RWF`

### Example 3: Type D (Luxury / Excise Duty + 18% VAT)
* **Wholesaler Tier**:
  - Supplier Cost = `1,000 RWF`
  - Pre-Tax Wholesale Price = $1,000 \times 1.20 = 1,200 \text{ RWF}$
  - Excise Duty Amount (10% of 1,200) = $1,200 \times 0.10 = 120 \text{ RWF}$
  - Taxable Subtotal = $1,200 + 120 = 1,320 \text{ RWF}$
  - VAT Amount (18% of 1,320) = $1,320 \times 0.18 = 237.60 \text{ RWF}$
  - Sum = $1,200 + 120 + 237.60 = 1,557.60 \text{ RWF}$
  - Final Wholesale Invoice Price (Banker's Rounded) = `1,558 RWF`
* **Retailer Tier**:
  - Purchased Price = `1,558 RWF`
  - Stripped Base Cost = Reversed back to `1,200 RWF` pre-tax/pre-excise base cost.
  - Pre-Tax Retail Price = $1,200 \times 1.20 = 1,440 \text{ RWF}$
  - Excise Duty Amount (10% of 1,440) = $1,440 \times 0.10 = 144 \text{ RWF}$
  - Taxable Subtotal = $1,440 + 144 = 1,584 \text{ RWF}$
  - VAT Amount (18% of 1,584) = $1,584 \times 0.18 = 285.12 \text{ RWF}$
  - Sum = $1,440 + 144 + 285.12 = 1,869.12 \text{ RWF}$
  - Final Consumer Shelf Price (Banker's Rounded) = `1,869 RWF`

---

## 4. Module 4: Inventory Management via the FIFO Rule

Market cost fluctuations require batch-level isolation:
1. **Stock Isolation Rule**: When a new shipment arrives, create an isolated entry in a `ProductBatch` table. Each batch permanently locks in its `supplierCost`, `calculatedWholesalePrice`, and `calculatedRetailPrice`.
2. **Selling Sequence Logic**: When a sale is processed, the system searches the available active batches for that product, sorting them chronologically by acquisition date (oldest first).
3. **Invisible Transition**: The system depletes items from the oldest batch. When the oldest batch's inventory reaches `0`, the checkout algorithm seamlessly shifts to the next oldest batch, applying that batch's distinct prices. This transition happens automatically without cashier intervention.

---

## 5. Module 5: The Sales Discount Safeguard System

To protect profit margins, the system enforces a strict validation gatekeeper:
1. **Validation Gate**: When a discount is entered during checkout, the backend compares the discount percentage with the administrator's `MAX_DISCOUNT_PCT` configuration.
2. **Block Action**: If the requested discount exceeds the maximum allowed percentage, the backend returns a strict HTTP `400 Bad Request` validation error, blocks transaction finalization, and prevents receipt signatures.

---

## 6. End-to-End User Experience & Price Display Flow

To clarify exactly how information is presented to each user tier in the interface:

### A. Wholesaler Portal (Creator / Provider)
* **Intake Form**: Wholesaler sees inputs for `Supplier Cost`, `Product Name`, `Barcode`, and a dropdown to select the `Tax Category (A, B, C, D)`.
* **Inventory Dashboard**: Displays:
  - Wholesaler Cost (Raw Intake).
  - Pre-Tax Wholesale Price.
  - Calculated Tax Breakdown (Excise + VAT value rows).
  - Final Wholesale Price (Price charged to Retailers).
* **Order Panel**: Displays order summaries placed by retailers, invoiced at the final wholesale price.

### B. Retailer Portal (Intermediary / POS Operator)
* **Procurement View**: When searching wholesaler catalogs, the retailer sees the wholesale price of the items (including taxes).
* **Inventory Panel**: Upon purchasing/inheriting, the retailer's inventory screen displays:
  - Inherited clean base cost (tax-stripped wholesale base).
  - Pre-Tax Retail Price (Base + Retailer Markup).
  - Retail Tax lines (computed based on the active tax category).
  - Final consumer shelf price.
* **POS Register (Cashier View)**: 
  - Shows dynamic item lookups with prices determined by the active batch's consumer price (FIFO).
  - **Discount Field**: Input field to apply discounts. If a cashier enters a discount exceeding the admin-defined safety floor, the UI immediately displays a warning and disables the "Pay/Fulfill" button.

### C. Consumer Portal (End User)
* **Product Catalog**: Consumers view products displaying only the final consumer shelf price (inclusive of taxes).
* **Receipt / Invoice Details**: Shows:
  - Total Paid Amount.
  - Tax Subtotals (exempt, zero-rated, VAT, and Excise duty).
  - Applied discounts (as a line item reduction).

---

## 7. Integration Mapping: Files & Code Locations

This section maps out exactly where the new modules hook into your existing codebase.

### A. Database Layer (`prisma/schema.prisma`)

* **New Settings Schema**:
  ```prisma
  model SystemSetting {
    id                 Int      @id @default(autoincrement())
    wholesalerMarkup   Float    @default(0.20) // 20%
    retailerMarkup     Float    @default(0.20) // 20%
    maxDiscountPct     Float    @default(0.05) // 5%
    exciseDutyRateD    Float    @default(0.10) // 10%
    updatedAt          DateTime @updatedAt
  }
  ```
* **New Batch Inventory Schema**:
  ```prisma
  model ProductBatch {
    id                     Int        @id @default(autoincrement())
    productId              Int
    supplierCost           Float      // Raw cost paid to supplier
    wholesalePricePreTax   Float      // Calculated wholesale base
    wholesalePricePostTax  Float      // Calculated wholesale shelf
    retailerPricePreTax    Float      // Inherited retailer base
    retailerPricePostTax   Float      // Shelf price for consumers
    initialQuantity        Float
    remainingQuantity      Float
    createdAt              DateTime   @default(now())
    product                Product    @relation(fields: [productId], references: [id])
    
    @@index([productId])
    @@map("product_batch")
   }
  ```
* **Product Enhancements**:
  - Add `taxCategory` (String) to `model Product`.

---

### B. Backend Controller & API Route Changes

#### 1. Configuration & Rules Access
* **File to Modify**: [adminController.ts](file:///c:/Users/Admin/Desktop/big_pos/big_company_backend/src/controllers/adminController.ts)
  - Modify `getSystemConfig` and `updateSystemConfig` functions to read/write settings in the new `SystemSetting` table.
* **New Endpoints**:
  - `GET /api/system-config/public`: Create a public config endpoint to expose the active `maxDiscountPct` to the POS frontend safely.

#### 2. Pricing Pipeline Implementations
* **New Service File**: `src/services/pricing.service.ts`
  - Implement calculations (Excise + VAT, Banker's rounding logic) to ensure precise RWF values.
* **Files to Modify**:
  - [wholesalerController.ts](file:///c:/Users/Admin/Desktop/big_pos/big_company_backend/src/controllers/wholesalerController.ts) in `createProduct` / `updateProduct`: Automatically call the pricing service to compute price sheets upon supplier cost input and register batches.
  - [retailerController.ts](file:///c:/Users/Admin/Desktop/big_pos/big_company_backend/src/controllers/retailerController.ts) in `createProduct`: Strip Type B and Type D taxes from wholesale values prior to applying retailer markup.

#### 3. FIFO Engine Integration
* **New Service File**: `src/services/fifo.service.ts`
  - Function: `allocateStockFromBatches(productId: number, quantity: number, transactionContext: PrismaClient)`
    - Iterates over active `ProductBatch` records (`remainingQuantity > 0` sorted by `createdAt ASC`) and deducts stock, returning the exact pricing tiers for the items sold.
* **Files to Modify**:
  - [retailerController.ts](file:///c:/Users/Admin/Desktop/big_pos/big_company_backend/src/controllers/retailerController.ts) in `createSale` (POS checkout): Replace simple product table deductions with the FIFO allocation engine.

#### 4. Sales Discount Safeguard Interceptor
* **New Middleware File**: `src/middleware/discountSafeguard.ts`
  - Checks requests sent to POS sale endpoints, queries the current config's `maxDiscountPct`, and responds with `400 Bad Request` if a transaction violates safety parameters.
* **Files to Modify**:
  - [retailerRoutes.ts](file:///c:/Users/Admin/Desktop/big_pos/big_company_backend/src/routes/retailerRoutes.ts): Mount the validation interceptor on the checkout route (`POST /pos/sale`).

---

### C. Frontend Interface Layer (`big_company/src`)

1. **Dashboard Controls**:
   - Update config views in the Admin dashboard to provide sliders/inputs for Wholesaler Markup %, Retailer Markup %, and POS Max Discount %.
2. **Display Price Formatting**:
   - Update the POS Cart and Product Cards to dynamically render the appropriate pricing tier (wholesale vs retail shelf) based on session role.
3. **Checkout Validation Warning**:
   - Add frontend validation checks on checkout input inputs, alerting the user immediately if the discount exceeds `MAX_DISCOUNT_PCT`.
