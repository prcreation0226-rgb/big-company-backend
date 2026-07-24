const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sales = await prisma.sale.findMany();
  const methods = new Set(sales.map(s => s.paymentMethod));
  console.log('ALL UNIQUE PAYMENT METHODS IN DB:', Array.from(methods));

  const momoSales = sales.filter(s => ['momo', 'mobile_money', 'airtel'].includes(s.paymentMethod));
  console.log('MOMO/AIRTEL SALES COUNT IN WHOLE DB:', momoSales.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
