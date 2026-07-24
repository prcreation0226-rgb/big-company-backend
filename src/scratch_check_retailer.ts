const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const retailerId = 24;
  const count = await prisma.sale.count({
    where: { retailerId }
  });
  console.log('Total sales count in database for retailer 24:', count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
