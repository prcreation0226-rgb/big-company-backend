import { Router } from 'express';
import { handleUSSDRequest } from '../controllers/ussdController';
import bodyParser from 'body-parser';

const router = Router();

// Main USSD request entry point
// Parse raw text for XML payloads (MTN), supporting missing or text/plain content-types
router.post(
  '/',
  bodyParser.text({
    type: (req) => {
      const contentType = req.headers['content-type'] || '';
      // Do not parse JSON or Form URL-encoded data as raw text, let other middleware handle those
      if (contentType.includes('json') || contentType.includes('x-www-form-urlencoded')) {
        return false;
      }
      return true;
    }
  }),
  handleUSSDRequest
);

export default router;

