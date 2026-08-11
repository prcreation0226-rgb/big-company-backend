import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Checking meter 2510170000067...');
  const meter = await prisma.gasMeter.findFirst({
    where: { meterNumber: '2510170000067' }
  });

  if (!meter) {
    console.error('❌ Meter 2510170000067 not found in the database.');
    return;
  }

  console.log(`Current meter type: ${meter.meterType}`);
  
  if (meter.meterType === 'PIPING') {
    console.log('✅ Meter type is already PIPING.');
    return;
  }

  await prisma.gasMeter.update({
    where: { id: meter.id },
    data: { meterType: 'PIPING' }
  });

  console.log('🎉 Successfully updated meter type to PIPING.');
}

main()
  .catch(e => {
    console.error('❌ Update failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
