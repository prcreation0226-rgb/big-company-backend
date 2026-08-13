const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const transactions = await prisma.gasRechargeTransaction.findMany({
      where: {
        meterNumber: '2510170000067',
        status: 'FAILED'
      }
    });
    console.log("=== Failed Gas Recharge Transactions ===");
    console.log(JSON.stringify(transactions, null, 2));

  } catch (error) {
    console.error("Error executing query:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
