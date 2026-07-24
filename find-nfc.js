const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const cards = await prisma.nfcCard.findMany();
  console.log("NFC Cards:", cards);
}
run().finally(() => prisma.$disconnect());
