import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Querying Kayitare Profile ---');
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: 'Kayitare' } },
        { name: { contains: 'Bertrand' } },
        { phone: { contains: '88881264' } }
      ]
    },
    include: {
      consumerProfile: true
    }
  });

  console.log(JSON.stringify(users, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
