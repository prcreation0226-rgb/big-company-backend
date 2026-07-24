const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  // Create Consumer User
  const user = await prisma.user.create({
    data: {
      name: 'Mock Consumer',
      email: 'consumer@mock.com',
      password: 'password123',
      role: 'consumer'
    }
  });

  // Create Consumer Profile
  const consumer = await prisma.consumerProfile.create({
    data: {
      userId: user.id,
      walletBalance: 1000000
    }
  });

  // Create Wallet for Consumer
  await prisma.wallet.create({
    data: {
      consumerId: consumer.id,
      type: 'dashboard_wallet',
      balance: 1000000
    }
  });

  // Create NFC Card linked to Consumer
  await prisma.nfcCard.upsert({
    where: { uid: '123456789' },
    update: {
      pin: '1234',
      consumerId: consumer.id,
      status: 'active'
    },
    create: {
      uid: '123456789',
      pin: '1234',
      status: 'active',
      balance: 0, // POS deducts from Wallet, not Card balance directly
      consumerId: consumer.id,
      cardType: 'Big Shop Card',
      cardholderName: 'Mock Consumer'
    }
  });
  console.log("Mock card successfully recreated! UID: 123456789, PIN: 1234");
}
run().catch(console.error).finally(() => prisma.$disconnect());
