import { Router } from 'express';
import { handleUSSDRequest } from '../controllers/ussdController';
import bodyParser from 'body-parser';

const router = Router();

// Main USSD request entry point
// Parse raw text for XML payloads (MTN)
router.post('/', bodyParser.text({ type: ['*/xml', 'text/xml', 'application/xml'] }), handleUSSDRequest);

export default router;

