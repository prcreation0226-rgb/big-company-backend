import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
    console.log('--- Suleyiman User Details ---');
    const profile = await prisma.consumerProfile.findUnique({
        where: { id: 17 },
        include: { user: true }
    });

    if (profile) {
        console.log(`Consumer ID: ${profile.id}`);
        console.log(`User ID: ${profile.userId}`);
        console.log(`Name: ${profile.fullName || profile.user?.name}`);
        console.log(`Phone in DB: [${profile.user?.phone}]`);
        console.log(`Email in DB: [${profile.user?.email}]`);
    } else {
        console.log('Suleyiman profile (ID 17) not found.');
    }

    await prisma.$disconnect();
}

run().catch(console.error);
