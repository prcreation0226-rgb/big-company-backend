const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const retailer = await prisma.retailerProfile.findFirst({
    where: { shopName: { contains: 'BBB' } }
  });
  console.log('RETAILER:', retailer);

  if (retailer) {
    const sales = await prisma.sale.findMany({
      where: { retailerId: retailer.id }
    });
    console.log('SALES FOR RETAILER:', JSON.stringify(sales, null, 2));
  } else {
    // Print all retailers
    const retailers = await prisma.retailerProfile.findMany();
    console.log('ALL RETAILERS:', retailers);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
