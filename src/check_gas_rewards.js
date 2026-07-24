const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rewards = await prisma.gasReward.findMany({
    where: {
      sale: { retailerId: 24 }
    }
  });
  console.log('ALL GAS REWARDS FOR RETAILER 24:', rewards);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
