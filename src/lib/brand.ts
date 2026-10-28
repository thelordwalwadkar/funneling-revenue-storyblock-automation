import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const LINKEDIN_URL = 'https://www.linkedin.com/in/seo-shubham/';

// Founder photo (the LinkedIn profile picture). Drop a square image at
// public/brand/shubham-walwadkar.jpg and the site uses it; until then the
// pages fall back to the initials badge.
const PHOTO = '/brand/shubham-walwadkar.jpg';
export const authorPhoto: string | null = existsSync(join(process.cwd(), 'public', PHOTO)) ? PHOTO : null;
