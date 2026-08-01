import { Router } from 'express';
import { handleUSSDRequest } from '../controllers/ussdController';

const router = Router();

// Main USSD request entry point
router.post('/', handleUSSDRequest);

export default router;
