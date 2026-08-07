import { Router } from 'express';
import { handleUSSDRequest } from '../controllers/ussdController';
import bodyParser from 'body-parser';

const router = Router();

// Main USSD request entry point
// Parse raw text for XML payloads (MTN), supporting missing or text/plain content-types
router.post(
  '/',
  bodyParser.text({ type: '*/*' }),
  handleUSSDRequest
);

export default router;

