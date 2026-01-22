// Seed script - injects fake test data into the database
// Guided by the Holy Spirit

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';

// Get the database path (same location as the app uses)
function getDatabasePath() {
  // Electron stores userData in ~/.config/fishwallet on Linux
  const userDataPath = join(homedir(), '.config', 'fishwallet');
  const dbDir = join(userDataPath, 'data');

  // Ensure the directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  return join(dbDir, 'fishwallet.db');
}

// Create tables if they don't exist
function createTables(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      content TEXT NOT NULL,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    )
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_ideas_updated_at ON ideas(updated_at);
    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_notes_idea_id ON notes(idea_id);
    CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
  `);
}

// Generate a timestamp for a specific hour of the day
function getTimestampForHour(baseDate, hour, minuteOffset = 0) {
  const date = new Date(baseDate);
  date.setHours(hour, minuteOffset, Math.floor(Math.random() * 60), 0);
  return date.getTime();
}

// Main seed function
function seed() {
  const dbPath = getDatabasePath();
  console.log(`Seeding database at: ${dbPath}`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');

  // Create tables if needed
  createTables(sqlite);

  // Base date - today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Create the main SaaS idea
  const ideaId = randomUUID();
  const ideaCreatedAt = getTimestampForHour(today, 7, 15); // 7:15 AM - morning coffee idea

  const insertIdea = sqlite.prepare(`
    INSERT INTO ideas (id, title, created_at, updated_at, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertIdea.run(
    ideaId,
    'SaaS Platform for Small Businesses',
    ideaCreatedAt,
    getTimestampForHour(today, 22, 30), // Last update at 10:30 PM
    'active'
  );

  console.log(`Created idea: SaaS Platform for Small Businesses`);

  // Notes - as if someone brainstormed throughout the day
  const notesData = [
    // Morning - initial spark
    {
      content: "Okay so I was thinking about this problem that small businesses have. They use like ten different tools to run their business. Invoicing here, CRM there, project management somewhere else. What if we built one platform that does it all but keeps it simple?",
      hour: 7, minute: 15, duration: 45000
    },
    {
      content: "The key differentiator would be simplicity. Not trying to compete with Salesforce or SAP. This is for the mom and pop shops, the local contractors, small agencies. They don't need enterprise features, they need something that just works.",
      hour: 7, minute: 23, duration: 38000
    },
    {
      content: "Core modules I'm thinking: invoicing, client management, simple project tracking, maybe a basic scheduler. That's it. No feature bloat.",
      hour: 7, minute: 28, duration: 22000
    },

    // Mid-morning - technical thoughts
    {
      content: "Tech stack thoughts. We could use React for the frontend, maybe Next.js for server-side rendering and SEO benefits. Backend could be Node with PostgreSQL. Keep it simple, scalable later.",
      hour: 9, minute: 45, duration: 35000
    },
    {
      content: "Actually thinking about it more, maybe we should consider a serverless approach. AWS Lambda or Vercel functions. Lower operational costs in the beginning, scales automatically.",
      hour: 10, minute: 12, duration: 28000
    },

    // Lunch break - business model
    {
      content: "Pricing model is crucial. I think freemium won't work here because small businesses actually value paying for tools they use. Maybe like fifteen to twenty dollars per month. Flat rate, no per-user nonsense.",
      hour: 12, minute: 30, duration: 42000
    },
    {
      content: "Or maybe we do a pay-what-you-can model for the first year? Build goodwill with the community. Get testimonials and case studies. Then normalize pricing.",
      hour: 12, minute: 38, duration: 25000
    },

    // Afternoon - feature deep dive
    {
      content: "The invoicing module needs to be rock solid. Accept payments directly, integrate with Stripe obviously. Send reminders automatically. Track who paid, who didn't. Generate reports for tax time.",
      hour: 14, minute: 15, duration: 48000
    },
    {
      content: "Client management should be super simple. Name, contact info, notes, history of interactions. Maybe a simple tagging system. No complex pipelines or deal stages unless they want it.",
      hour: 14, minute: 28, duration: 33000
    },
    {
      content: "Project tracking - kanban board style. To do, doing, done. Maybe add custom columns if needed. Time tracking built in but not required. Some people hate time tracking.",
      hour: 14, minute: 45, duration: 31000
    },
    {
      content: "Oh and mobile app is essential. Not a scaled down web view but a real native app. Small business owners are always on the go. They need to send invoices from their phone, check appointments, log quick notes.",
      hour: 15, minute: 10, duration: 37000
    },

    // Late afternoon - competition analysis
    {
      content: "Looked at some competitors. Wave is free but ad-supported and limited. FreshBooks is good but getting pricey. QuickBooks is overkill for most small businesses. There's definitely a gap in the market.",
      hour: 16, minute: 20, duration: 40000
    },
    {
      content: "The onboarding experience needs to be exceptional. Like five minutes to get started. Import your clients from a spreadsheet, send your first invoice, boom. No lengthy setup wizards.",
      hour: 16, minute: 35, duration: 29000
    },

    // Evening - naming and branding
    {
      content: "Need a good name. Something memorable but professional. Not too cute, not too corporate. Maybe something with flow or simple in it? SimpleFlow? FlowBiz? Need to brainstorm more.",
      hour: 19, minute: 0, duration: 26000
    },
    {
      content: "BizFlow, RunSimple, SmallBizHub, OneShop, ShopKeeper... actually ShopKeeper is kind of nice. Has that classic feel but modern. Need to check if domain is available.",
      hour: 19, minute: 8, duration: 34000
    },

    // Night - validation thoughts
    {
      content: "Before building anything I should validate this. Talk to actual small business owners. What tools are they using now? What frustrates them? Would they switch? What would make them switch?",
      hour: 21, minute: 15, duration: 38000
    },
    {
      content: "Could start with a landing page, collect emails, gauge interest. Maybe do a small survey on social media. Find small business Facebook groups or subreddits.",
      hour: 21, minute: 25, duration: 27000
    },
    {
      content: "MVP scope should be invoicing plus client management. That's it. Get those two things perfect. Add project management later based on user feedback. Don't build what people might want, build what they definitely need.",
      hour: 22, minute: 0, duration: 41000
    },
    {
      content: "Final thought for tonight - the mission is to give small business owners their time back. They didn't start a business to do admin work. They started it to do what they love. If we can save them even two hours a week, that's huge.",
      hour: 22, minute: 30, duration: 35000
    }
  ];

  // Insert all notes
  const insertNote = sqlite.prepare(`
    INSERT INTO notes (id, idea_id, content, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const note of notesData) {
    const noteId = randomUUID();
    const createdAt = getTimestampForHour(today, note.hour, note.minute);

    insertNote.run(
      noteId,
      ideaId,
      note.content,
      note.duration,
      createdAt
    );
  }

  console.log(`Created ${notesData.length} notes`);

  // Create a second smaller idea for variety
  const idea2Id = randomUUID();
  const idea2CreatedAt = getTimestampForHour(new Date(today.getTime() - 86400000), 15, 0); // Yesterday 3 PM

  insertIdea.run(
    idea2Id,
    'Meditation App Concept',
    idea2CreatedAt,
    idea2CreatedAt,
    'active'
  );

  const meditationNotes = [
    {
      content: "What if there was a meditation app specifically for busy professionals? Like five minute sessions max. No fluff, no spiritual stuff if you don't want it. Just breathing exercises and focus techniques.",
      hour: 15, minute: 0, duration: 32000
    },
    {
      content: "Could integrate with calendar apps. Detect stressful days based on meeting density. Suggest a quick breathing exercise before a big presentation.",
      hour: 15, minute: 12, duration: 28000
    },
    {
      content: "Monetization through corporate wellness programs. Companies pay for employee subscriptions. Win win.",
      hour: 15, minute: 20, duration: 18000
    }
  ];

  for (const note of meditationNotes) {
    const noteId = randomUUID();
    const createdAt = getTimestampForHour(new Date(today.getTime() - 86400000), note.hour, note.minute);

    insertNote.run(
      noteId,
      idea2Id,
      note.content,
      note.duration,
      createdAt
    );
  }

  console.log(`Created idea: Meditation App Concept with ${meditationNotes.length} notes`);

  // Create a third archived idea
  const idea3Id = randomUUID();
  const idea3CreatedAt = getTimestampForHour(new Date(today.getTime() - 172800000), 10, 0); // 2 days ago

  insertIdea.run(
    idea3Id,
    'Recipe Sharing Platform',
    idea3CreatedAt,
    idea3CreatedAt,
    'archived'
  );

  insertNote.run(
    randomUUID(),
    idea3Id,
    "Thought about a recipe app but realized the market is super saturated. Pinterest, AllRecipes, TikTok recipes. Not worth pursuing right now.",
    25000,
    idea3CreatedAt
  );

  console.log(`Created idea: Recipe Sharing Platform (archived) with 1 note`);

  sqlite.close();
  console.log('\nSeeding complete!');
}

// Run the seed
seed();
