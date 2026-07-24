import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';

export const getWholesalerProfile = async (req: AuthRequest, res: Response) => {
    try {
        console.log('👤 Fetching wholesaler profile for user:', req.user?.id);

        const profile = await prisma.wholesalerProfile.findUnique({
            where: { userId: req.user!.id },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        phone: true,
                        name: true,
                        role: true
                    }
                },
                wholesalerSettings: true
            }
        });

        if (!profile.wholesalerSettings) {
            const defaultSettings = await prisma.wholesalerSettings.create({
                data: {
                    wholesalerId: profile.id
                }
            });
            (profile as any).wholesalerSettings = defaultSettings;
        }

        // Map wholesalerSettings to settings for frontend compatibility
        const profileResponse = {
            ...profile,
            settings: profile.wholesalerSettings
        };

        res.json({ success: true, profile: profileResponse });
    } catch (error: any) {
        console.error('❌ Error fetching profile:', error);
        res.status(500).json({ error: error.message });
    }
};

export const updateWholesalerProfile = async (req: AuthRequest, res: Response) => {
    try {
        const { name, company_name, contact_person, email, phone, address, tin_number } = req.body;
        console.log('✏️ Updating wholesaler profile:', req.user?.id);

        const profile = await prisma.wholesalerProfile.findUnique({
            where: { userId: req.user!.id }
        });

        if (!profile) {
            return res.status(404).json({ error: 'Wholesaler profile not found' });
        }

        // Update User's details if provided
        if (name || phone || email) {
            await prisma.user.update({
                where: { id: req.user!.id },
                data: {
                    ...(name && { name }),
                    ...(phone && { phone }),
                    ...(email && { email })
                }
            });
        }

        // Update WholesalerProfile
        const updatedProfile = await prisma.wholesalerProfile.update({
            where: { id: profile.id },
            data: {
                ...(company_name && { companyName: company_name }),
                ...(contact_person && { contactPerson: contact_person }),
                ...(address && { address }),
                ...(tin_number && { tinNumber: tin_number })
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        phone: true,
                        name: true,
                        role: true
                    }
                },
                wholesalerSettings: true
            }
        });

        // Map wholesalerSettings to settings for frontend compatibility
        const profileResponse = {
            ...updatedProfile,
            settings: updatedProfile.wholesalerSettings
        };

        res.json({ success: true, profile: profileResponse });
    } catch (error: any) {
        console.error('❌ Error updating profile:', error);
        if (error.code === 'P2002') {
            const target = error.meta?.target || '';
            let msg = 'A record with this value already exists.';
            if (target.includes('phone')) {
                msg = 'This phone number is already registered to another account.';
            } else if (target.includes('email')) {
                msg = 'This email address is already registered to another account.';
            }
            return res.status(400).json({ error: msg });
        }
        res.status(500).json({ error: error.message });
    }
};

export const updateWholesalerSettings = async (req: AuthRequest, res: Response) => {
    try {
        const settingsData = req.body;
        console.log('⚙️ Updating wholesaler settings:', req.user?.id);

        const profile = await prisma.wholesalerProfile.findUnique({
            where: { userId: req.user!.id },
            include: { wholesalerSettings: true }
        });

        if (!profile) {
            return res.status(404).json({ error: 'Wholesaler profile not found' });
        }

        let updatedSettings;
        if (!profile.wholesalerSettings) {
            // Create new settings
            updatedSettings = await prisma.wholesalerSettings.create({
                data: {
                    wholesalerId: profile.id,
                    ...settingsData
                }
            });
        } else {
            // Update existing settings
            updatedSettings = await prisma.wholesalerSettings.update({
                where: { id: profile.wholesalerSettings.id },
                data: settingsData
            });
        }

        res.json({ success: true, settings: updatedSettings });
    } catch (error: any) {
        console.error('❌ Error updating settings:', error);
        res.status(500).json({ error: error.message });
    }
};
