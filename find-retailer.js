const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const retailerProduct = await prisma.product.findFirst({ where: { name: 'test12', retailerId: { not: null } } });
  console.log("Retailer Product:", retailerProduct);
}
run().finally(() => prisma.$disconnect());
