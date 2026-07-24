import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const meters = await prisma.gasMeter.findMany({
    where: {
      OR: [
        { meterNumber: '2510170000067' },
        { imei: '2510170000067' }
      ]
    }
  });

  console.log(JSON.stringify(meters, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
