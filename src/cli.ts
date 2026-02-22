import {
  createAccount,
  listAccounts,
  getConnector,
  getAccount,
  addSafeContact,
  getSafeContacts,
  getContacts,
} from "./lib/account-manager.js";
import { scanAccount } from "./lib/scanner.js";
import { queries } from "./lib/db.js";
import QRCode from "qrcode-terminal";

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "pair": {
      const name = args[0] || "ילד 1";
      const childName = args[1] || name;
      const childBirthdate = args[2] || "2012-01-01";
      const childGender = args[3] || "boy";

      console.log(`\n🔗 מצמד חשבון חדש: ${name} (${childName})\n`);

      const { accountId, connector } = await createAccount(name, childName, childBirthdate, childGender);
      console.log(`📋 Account ID: ${accountId}`);

      connector.on("qr", (qr: string) => {
        console.log("\n📱 סרוק את הקוד עם הוואטסאפ של הילד:\n");
        QRCode.generate(qr, { small: true });
        console.log("\nWhatsApp → הגדרות → מכשירים מקושרים → קשר מכשיר\n");
      });

      connector.on("connected", () => {
        console.log("✅ מחובר! מסנכרן הודעות...");
      });

      connector.on("sync_progress", (p: { progress: number; messages: number }) => {
        process.stdout.write(`\r📥 סנכרון: ${p.progress}% | ${p.messages} הודעות`);
      });

      connector.on("ready", () => {
        const count = queries.getMessageCount.get(accountId) as { count: number };
        const contacts = getContacts(accountId);
        console.log(`\n\n🎉 מוכן!`);
        console.log(`   📨 ${count.count} הודעות`);
        console.log(`   👥 ${contacts.length} אנשי קשר/קבוצות`);
        console.log(`\n💡 הפקודות הבאות:`);
        console.log(`   npm run scan -- ${accountId}         # סריקה`);
        console.log(`   npm run accounts                      # רשימת חשבונות`);
        console.log(`\n📌 ה-session נשמר — לא תצטרך QR שוב.\n`);
      });

      // Keep alive
      await new Promise(() => {});
      break;
    }

    case "list": {
      const accounts = listAccounts();
      if (accounts.length === 0) {
        console.log("\n📭 אין חשבונות. צמד אחד עם:\n   npm run pair -- <שם>\n");
        break;
      }
      console.log(`\n📋 חשבונות (${accounts.length}):\n`);
      for (const acc of accounts) {
        const msgCount = queries.getMessageCount.get(acc.id) as { count: number };
        const lastScan = queries.getLastScan.get(acc.id) as any;
        const safeCount = getSafeContacts(acc.id).length;
        const lastScanStr = lastScan
          ? new Date(lastScan.started_at * 1000).toLocaleString("he-IL")
          : "אף פעם";

        console.log(`  ${acc.status === "ready" ? "🟢" : "⚪"} ${acc.id}`);
        console.log(`     ${acc.child_name || acc.name} (${acc.child_birthdate || "?"})`);
        console.log(`     📨 ${msgCount.count} הודעות | 🔒 ${safeCount} בטוחים | סריקה: ${lastScanStr}`);
        console.log();
      }
      break;
    }

    case "scan": {
      const accountId = args[0];
      if (!accountId) {
        console.log("\n❌ חסר account ID. שימוש:\n   npm run scan -- <accountId>\n");
        const accounts = listAccounts();
        if (accounts.length > 0) {
          console.log("חשבונות זמינים:");
          accounts.forEach((a) => console.log(`   ${a.id} — ${a.child_name || a.name}`));
        }
        break;
      }

      const account = getAccount(accountId);
      if (!account) {
        console.log(`\n❌ חשבון ${accountId} לא נמצא\n`);
        break;
      }

      console.log(`\n🔍 מתחיל סריקה: ${account.child_name || account.name}\n`);

      // Reconnect if needed
      if (account.status !== "ready") {
        console.log("🔄 מתחבר מחדש...");
        const connector = await getConnector(accountId);
        if (!connector) {
          console.log("❌ לא הצלחתי להתחבר");
          break;
        }
        // Wait for ready
        await new Promise<void>((resolve) => {
          if (connector.isReady()) return resolve();
          connector.on("ready", () => resolve());
          setTimeout(() => resolve(), 30000);
        });
      }

      const result = await scanAccount(accountId, (msg) => console.log(`  ${msg}`));

      console.log(`\n📊 תוצאות סריקה:`);
      console.log(`   הודעות חדשות: ${result.messagesNew}`);
      console.log(`   הודעות שנסרקו: ${result.messagesScanned}`);
      console.log(`   צ׳אטים: ${result.chatsScanned} נסרקו, ${result.chatsSkipped} דולגו (בטוחים)`);
      console.log(`   עלות: $${result.cost.toFixed(4)}`);
      console.log(`   זמן: ${(result.durationMs / 1000).toFixed(1)} שניות`);

      if (result.alerts.length === 0) {
        console.log(`\n   🎉 לא נמצאו ממצאים — הכל תקין!\n`);
      } else {
        console.log(`\n   🔔 ${result.alerts.length} ממצאים:\n`);
        for (const alert of result.alerts) {
          const icon = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" }[alert.severity];
          console.log(`   ${icon} [${alert.category}] (${Math.round(alert.confidence * 100)}%)`);
          console.log(`      ${alert.summary}`);
          console.log(`      💡 ${alert.recommendation}`);
          console.log(`      📍 ${alert.chatName}`);
          console.log();
        }
      }
      break;
    }

    case "safe": {
      const [subCmd, accountId, ...rest] = args;

      if (subCmd === "add" && accountId && rest.length >= 1) {
        const jid = rest[0].includes("@") ? rest[0] : `${rest[0]}@s.whatsapp.net`;
        const name = rest.slice(1).join(" ") || rest[0];
        addSafeContact(accountId, jid, name, "family");
        console.log(`✅ נוסף כבטוח: ${name} (${jid})`);
      } else if (subCmd === "list" && accountId) {
        const safe = getSafeContacts(accountId);
        console.log(`\n🔒 אנשים בטוחים (${safe.length}):\n`);
        for (const s of safe) {
          console.log(`   👤 ${s.name} — ${s.jid} (${s.relationship})`);
        }
        console.log();
      } else {
        console.log("\nשימוש:");
        console.log("  npm run start -- safe add <accountId> <phone> <name>");
        console.log("  npm run start -- safe list <accountId>\n");
      }
      break;
    }

    case "contacts": {
      const accountId = args[0];
      if (!accountId) { console.log("❌ חסר accountId"); break; }
      const contacts = getContacts(accountId);
      const safe = new Set(getSafeContacts(accountId).map((s: any) => s.jid));

      console.log(`\n👥 אנשי קשר (${contacts.length}):\n`);
      for (const c of contacts) {
        const icon = safe.has(c.jid) ? "🔒" : c.is_group ? "👥" : "👤";
        console.log(`   ${icon} ${c.name} — ${c.message_count} הודעות`);
      }
      console.log();
      break;
    }

    case "history": {
      const accountId = args[0];
      if (!accountId) { console.log("❌ חסר accountId"); break; }
      const scans = queries.getScanHistory.all(accountId, 10) as any[];

      console.log(`\n📜 היסטוריית סריקות:\n`);
      for (const scan of scans) {
        const date = new Date(scan.started_at * 1000).toLocaleString("he-IL");
        const icon = scan.alerts_found > 0 ? "🔔" : "✅";
        console.log(`   ${icon} ${date} — ${scan.messages_scanned} הודעות, ${scan.alerts_found} ממצאים, $${scan.cost?.toFixed(4) || 0}`);
      }
      console.log();
      break;
    }

    default:
      console.log(`
🛡️  WhatsApp Kids Monitor — CLI

פקודות:
  pair <name> [childName] [age]   צימוד חשבון חדש (QR)
  list                            רשימת חשבונות
  scan <accountId>                סריקה יזומה
  safe add <accountId> <phone> <name>   הוספת איש קשר בטוח
  safe list <accountId>           רשימת אנשים בטוחים
  contacts <accountId>            רשימת אנשי קשר
  history <accountId>             היסטוריית סריקות

שימוש:
  npx tsx src/cli.ts <command> [args]
  npm run pair -- "דניאל"
  npm run scan -- kid_abc12345
      `);
  }
}

main().catch((err) => {
  console.error("❌", err.message || err);
  process.exit(1);
});
