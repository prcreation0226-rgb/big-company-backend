import prisma from './utils/prisma';

async function checkRetailer24Links() {
  const requests = await prisma.customerLinkRequest.findMany({
    where: { retailerId: 24 },
    include: {
      customer: {
        include: {
          user: true
        }
      }
    }
  });

  console.log('--- LINK REQUESTS FOR RETAILER 24 (IKIZERE SHOP) ---');
  console.log(requests);
}

checkRetailer24Links();
