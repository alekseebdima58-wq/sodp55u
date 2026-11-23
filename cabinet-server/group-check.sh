D="${CABINET_STATE_DIR:-$(systemctl show -p Environment $(systemctl list-units --type=service --all --no-legend | grep -iE 'cabinet|sodp' | awk '{print $1}' | head -1) 2>/dev/null | grep -o 'CABINET_STATE_DIR=[^ ]*' | cut -d= -f2)}"; D="${D:-$HOME/.local/state/sodp55u-cabinet}"; echo "папка: $D"
node -e '
const fs=require("fs"),p=require("path"),d=process.argv[1];
for(const a of fs.readdirSync(d)){const f=p.join(d,a);if(!fs.statSync(f).isDirectory())continue;
 for(const n of fs.readdirSync(f).filter(n=>/^\d+\.json$/.test(n))){const s=JSON.parse(fs.readFileSync(p.join(f,n))).snapshot||{};
  console.log(`\n${a.slice(0,6)}… обновлено: ${s.syncedAt||"-"}, статус: ${s.status}`);
  for(const t of (s.sections?.group||[])){console.log("  столбцы: "+t.columns.join(", ")+"; строк: "+t.rows.length);
   t.columns.forEach((c,i)=>console.log(`   ${c||"(без названия)"}: заполнено ${t.rows.filter(r=>r[i]&&String(r[i]).trim()).length}`));}
  if(!s.sections?.group)console.log("  группы нет");}}' "$D"
