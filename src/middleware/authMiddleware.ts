import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    role: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;
    
    if (decoded.require_password_reset && !req.originalUrl.includes('/update-password') && !req.originalUrl.includes('/update-pin')) {
      return res.status(403).json({ error: 'Password reset required', require_password_reset: true });
    }
    
    req.user = {
      id: Number(decoded.id),
      role: decoded.role
    };
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

// Optional authentication - populates req.user if valid token present, but doesn't block
export const optionalAuthenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token - continue without user
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    if (decoded.require_password_reset && !req.originalUrl.includes('/update-password') && !req.originalUrl.includes('/update-pin')) {
      return next(); // Don't populate user if reset is required, acts as no token
    }

    req.user = {
      id: Number(decoded.id),
      role: decoded.role
    };

    next();
  } catch (error) {
    // Invalid token - continue without user (don't block)
    next();
  }
};
