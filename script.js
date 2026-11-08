(() => {
'use strict';
const $ = id => document.getElementById(id);
const HADITH_BASE = 'https://gibreelabdullah.github.io/hadith-db/data';
const COLLECTIONS = {
  bukhari: 'Sahih al-Bukhari', muslim: 'Sahih Muslim', abudawud: 'Sunan Abu Dawud',
  tirmidhi: "Jami' at-Tirmidhi", nasai: "Sunan an-Nasa'i", ibnmajah: 'Sunan Ibn Majah'
};
const showStatus = (el, text, error=false) => { if(el){el.textContent=text;el.classList.toggle('error',!!error);} };
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtTime = d => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
const safeJson = async url => { const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); };
function arabicText(s){ return `<div class="arabic" lang="ar" dir="rtl">${esc(s||'Arabic text is not available in the selected source.')}</div>`; }
function gradeList(grades, collection) {
  let list=[];
  if (Array.isArray(grades)) list=grades;
  else if (grades && typeof grades==='object' && ['grade','grading','hukm','status','authenticity','value'].some(k=>grades[k]!==undefined)) list=[grades];
  else if (grades && typeof grades==='object' && Array.isArray(grades.grades)) list=grades.grades;
  else if (grades && typeof grades==='object') list=Object.entries(grades).map(([k,v])=>typeof v==='object'?{scholar:k,...v}:{scholar:k,grade:v});
  if (!list.length && (collection==='bukhari' || collection==='muslim')) {
    const label = collection==='bukhari' ? 'Sahih' : 'Sahih';
    return `<div class="grade-list"><div class="grade-row"><strong>Collection classification</strong><span class="tag">${label}</span></div></div>`;
  }
  if (!list.length) return '<p class="muted small">Grade unavailable</p>';
  return `<div class="grade-list">${list.map(g=>{
    const scholar=g.scholar||g.muhaddith||g.scholarName||g.name||g.author||g.grader||'';
    const raw=g.grade||g.grading||g.hukm||g.status||g.authenticity||g.value||'';
    const grade=String(raw).match(/hasan|da.?if|weak|sahih|good|authentic/i)?.[0] || raw;
    const source=g.source||g.reference||g.book||g.ref||g.sourceName||'';
    return `<div class="grade-row"><div>${scholar?`<strong>${esc(scholar)}</strong>`:''}${source?`<br><small>${esc(source)}</small>`:''}</div><span class="tag">${esc(grade||'Grade unavailable')}</span></div>`;
  }).join('')}</div>`;
}
const FALLBACK_EDITION = {
  bukhari:'bukhari', muslim:'muslim', abudawud:'abudawud',
  tirmidhi:'tirmidhi', nasai:'nasai', ibnmajah:'ibnmajah'
};
async function loadHadithData(collection) {
  const root = `${HADITH_BASE}/books/${collection}`;
  // Prefer HadithHub's own metadata and grading files.
  try {
    const metadata = await safeJson(`${root}/metadata.json`);
    let grades = {};
    try { grades = await safeJson(`${root}/gradings.json`); } catch(e) {}
    if (Array.isArray(metadata.records) && metadata.offsets) {
      return {metadata, grades, root, source:'hadithhub'};
    }
  } catch(e) {}
  // Text fallback: Fawaz Ahmed's public static Hadith API editions.
  // Do not pretend these fallback records contain HadithHub scholar gradings.
  const id = FALLBACK_EDITION[collection];
  if (!id) throw new Error('Unknown collection.');
  const base = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';
  const [enData, arData] = await Promise.all([
    safeJson(`${base}/eng-${id}.json`),
    safeJson(`${base}/ara-${id}.json`).catch(()=>({hadiths:[]}))
  ]);
  const en = Array.isArray(enData.hadiths) ? enData.hadiths : [];
  const ar = Array.isArray(arData.hadiths) ? arData.hadiths : [];
  if (!en.length) throw new Error('The selected collection is not available from the backup source.');
  const records = en.map((h,i)=>({
    num: String(h.hadithnumber ?? h.number ?? i+1),
    book: h.reference?.book ?? h.book ?? '',
    _en: h.text ?? h.english?.text ?? '',
    _ar: ar[i]?.text ?? ar[i]?.arabic ?? '',
    _reference: h.reference ?? {},
    _grade: h.grade ?? h.grading ?? h.hukm ?? h.status ?? h.authenticity ?? null
  }));
  return {metadata:{records}, grades:{}, root, source:'fallback'};
}
const hadithTextCache = new Map();
async function fetchHadithTextFile(root, lang) {
  const key = `${root}/${lang}.txt`;
  if (!hadithTextCache.has(key)) {
    hadithTextCache.set(key, fetch(key).then(r=>{if(!r.ok)throw Error(`HTTP ${r.status} loading ${lang} text`);return r.text();}));
  }
  return hadithTextCache.get(key);
}
function parseHadithLine(line, fallbackNumber) {
  const first=line.indexOf('|');
  const second=first<0?-1:line.indexOf('|',first+1);
  if(first<0||second<0)return line.trim();
  return line.slice(second+1).replace(/\\n/g,'\n').trim();
}
function findGradeRecord(node, number, seen=new Set()) {
  if (!node || typeof node!=='object' || seen.has(node)) return null;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) { const found=findGradeRecord(item,number,seen); if(found)return found; }
    return null;
  }
  const numberKeys=['num','number','hadith','hadithNumber','hadith_number','hadithNum','id','hadith_id'];
  const n=numberKeys.map(k=>node[k]).find(v=>v!==undefined&&v!==null);
  const hasGrade=['grade','grading','hukm','status','authenticity','grades','opinions','gradings'].some(k=>node[k]!==undefined);
  if(n!==undefined && String(n)===String(number) && hasGrade) return node.grades||node.gradings||node.opinions||node;
  if(Object.prototype.hasOwnProperty.call(node,String(number))) {
    const direct=node[String(number)];
    if(direct && typeof direct==='object') return direct.grades||direct.gradings||direct.opinions||direct;
    if(typeof direct==='string') return {grade:direct,scholar:'As recorded by HadithHub'};
  }
  for(const [k,v] of Object.entries(node)) {
    if(['metadata','books','collection','collection_info'].includes(k)) continue;
    const found=findGradeRecord(v,number,seen); if(found)return found;
  }
  return null;
}
function lookupGrade(grades, record, idx) {
  if(!grades)return null;
  const n=String(record.num??record.number??idx+1);
  const found=findGradeRecord(grades,n);
  if(found) return found;
  if(Array.isArray(grades)) return grades[idx]||null;
  return null;
}
async function getHadith(collection, number) {
  const d = await loadHadithData(collection);
  const records = d.metadata.records || [];
  let rec = records.find(r=>String(r.num ?? r.number)===String(number));
  if (!rec && Number(number)>0 && Number(number)<=records.length) rec=records[Number(number)-1];
  if (!rec) throw new Error('That number was not found in the selected collection.');
  let ar=rec._ar||'', en=rec._en||'';
  if (d.source==='hadithhub') {
    const [arText,enText]=await Promise.all([fetchHadithTextFile(d.root,'ar'),fetchHadithTextFile(d.root,'en')]);
    const idx=Number.isInteger(Number(rec.line))?Number(rec.line):records.indexOf(rec);
    ar=parseHadithLine((arText.split(/\r?\n/)[idx]||''),rec.num);
    en=parseHadithLine((enText.split(/\r?\n/)[idx]||''),rec.num);
  }
  return {collection, rec, ar, en, grade:d.source==='hadithhub'?(lookupGrade(d.grades,rec,records.indexOf(rec))||lookupGrade(d.metadata,rec,records.indexOf(rec))):(rec._grade?{grade:rec._grade}:null), metadata:d.metadata, source:d.source};
}
function renderHadith(target, data) {
  const title=COLLECTIONS[data.collection]||data.collection;
  const number=data.rec.num||data.rec.number||'?';
  const verifyUrl=`https://hadithhub.com/${data.collection}:${encodeURIComponent(number)}`;
  target.innerHTML=`<article class="card"><div class="eyebrow">${esc(title)} · Hadith ${esc(number)}</div>${arabicText(data.ar)}<hr style="border-color:var(--line);margin:1rem 0"><p>${esc(data.en||'English translation is not available in this source.')}</p><div class="ref">Reference: ${esc(title)} ${esc(number)}${data.rec.book?` · Book ${esc(data.rec.book)}`:''}</div><h3 style="margin-top:1.2rem">Scholar gradings</h3>${gradeList(data.grade,data.collection)}<p><a href="${verifyUrl}" target="_blank" rel="noopener">Verify on HadithHub ↗</a></p></article>`;
}
async function initHadith() {
  const collection=$('hadith-collection'), num=$('hadith-number'), status=$('hadith-status'), results=$('hadith-results');
  if(!collection||!num||!status||!results)return;
  const load=async n=>{
    showStatus(status,'Loading…');
    try { const data=await getHadith(collection.value,n); renderHadith(results,data); showStatus(status,''); }
    catch(e){ showStatus(status,'Could not load this Hadith. Please try again.',true); results.innerHTML=''; }
  };
  $('load-hadith')?.addEventListener('click',()=>load(Math.max(1,Number(num.value)||1)));
  $('load-random')?.addEventListener('click',async()=>{
    try { showStatus(status,'Finding a random Hadith…'); const d=await loadHadithData(collection.value); const recs=d.metadata.records||[]; if(!recs.length)throw Error('No records in metadata'); const rec=recs[Math.floor(Math.random()*recs.length)]; num.value=rec.num||rec.number||1; await load(num.value); }
    catch(e){showStatus(status,'Could not select a random Hadith: '+e.message,true);}
  });
  collection.addEventListener('change',()=>{num.value=1;});
  // Daily Hadith card uses a stable date-derived number to avoid a new random result every refresh.
  try {
    const col='bukhari'; const d=await loadHadithData(col); const n=Math.max(1,(new Date().getUTCDate()+new Date().getUTCMonth()*31)%Math.max(1,(d.metadata.records||[]).length)+1);
    const h=await getHadith(col,n);
    if($('daily-hadith-ar'))$('daily-hadith-ar').textContent=h.ar||'';
    if($('daily-hadith-en'))$('daily-hadith-en').textContent=h.en||'';
    if($('daily-hadith-ref'))$('daily-hadith-ref').textContent=`${COLLECTIONS[col]} ${h.rec.num||n}`;
  }catch(e){}
}
async function initQuran() {
  const select=$('surah'), status=$('quran-status'), results=$('quran-results');
  if(!select||!status||!results)return;
  const translations=$('quran-translation');
  try {
    const data=await safeJson('https://api.alquran.cloud/v1/surah');
    data.data.forEach(s=>{const o=document.createElement('option');o.value=s.number;o.textContent=`${s.number}. ${s.englishName} (${s.name})`;select.append(o);});
    showStatus(status,'Select a Surah and the translations you want to read.');
  }catch(e){showStatus(status,'Could not load the Surah list. Check your connection.',true);return;}
  const load=async()=>{
    const surahNo=Number(select.value||1);
    const editions=[...translations.selectedOptions].map(o=>o.value);
    if(!editions.length){showStatus(status,'Select at least one English translation.',true);return;}
    showStatus(status,'Loading the complete Surah…');results.innerHTML='';
    try{
      const [arabic,...translated]=await Promise.all([
        safeJson(`https://api.alquran.cloud/v1/surah/${surahNo}/quran-uthmani`),
        ...editions.map(id=>safeJson(`https://api.alquran.cloud/v1/surah/${surahNo}/${id}`))
      ]);
      const ayahs=arabic.data.ayahs||[];
      const translationData=translated.map((d,i)=>({name:translations.selectedOptions[i].textContent,ayahs:d.data.ayahs||[]}));
      if(!ayahs.length)throw new Error('No ayahs were returned for this Surah.');
      const surahName=arabic.data.englishName;
      results.innerHTML=`<div class="card"><div class="eyebrow">Surah ${arabic.data.number} · ${esc(surahName)} · ${esc(arabic.data.name)}</div><h2>${esc(surahName)}</h2><p class="muted">${arabic.data.numberOfAyahs} ayahs · ${esc(arabic.data.revelationType||'')}</p></div>`+
        ayahs.map((a,i)=>{
          const translationsHtml=translationData.map(t=>`<div class="translation-block"><div class="eyebrow">${esc(t.name)}</div><p>${esc(t.ayahs[i]?.text||'Translation unavailable for this ayah.')}</p></div>`).join('');
          return `<article class="card ayah-card"><div class="ayah-heading"><span class="tag">${a.numberInSurah}</span><span class="ref">${arabic.data.number}:${a.numberInSurah}</span></div><div class="arabic" lang="ar" dir="rtl">${esc(a.text)}</div>${translationsHtml}</article>`;
        }).join('');
      showStatus(status,`${surahName} loaded · ${ayahs.length} ayahs.`);
      const first=ayahs[0];
      if($('daily-ayah-ar'))$('daily-ayah-ar').textContent=first.text;
      if($('daily-ayah-en'))$('daily-ayah-en').textContent=translationData[0]?.ayahs[0]?.text||'';
      if($('daily-ayah-ref'))$('daily-ayah-ref').textContent=`${surahName} ${surahNo}:1`;
    }catch(e){showStatus(status,'Could not load the complete Surah. Please try again.',true);}
  };
  $('load-surah')?.addEventListener('click',load);
  select.addEventListener('change',load);
  if(select.options.length){select.value='1';await load();}
}
const duas = [
{cat:'Morning & evening',ar:'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ',tr:'Asbahna wa asbahal-mulku lillah',en:'We have reached the morning and at this very time the whole kingdom belongs to Allah.',ref:'Sahih Muslim 2723 (morning/evening remembrance wording has variants)'},
{cat:'Morning & evening',ar:'اللَّهُمَّ بِكَ أَصْبَحْنَا وَبِكَ أَمْسَيْنَا',tr:'Allahumma bika asbahna wa bika amsayna',en:'O Allah, by You we reach the morning and by You we reach the evening.',ref:'Jami at-Tirmidhi 3391; verify wording and grading by edition'},
{cat:'Forgiveness',ar:'رَبَّنَا ظَلَمْنَا أَنْفُسَنَا وَإِنْ لَمْ تَغْفِرْ لَنَا وَتَرْحَمْنَا لَنَكُونَنَّ مِنَ الْخَاسِرِينَ',tr:'Rabbana zalamna anfusana wa in lam taghfir lana wa tarhamna lanakunanna minal-khasirin',en:'Our Lord, we have wronged ourselves, and if You do not forgive us and have mercy on us, we will surely be among the losers.',ref:'Quran 7:23'},
{cat:'Forgiveness',ar:'رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنْتَ التَّوَّابُ الرَّحِيمُ',tr:'Rabbighfir li wa tub alayya innaka antat-Tawwabur-Rahim',en:'My Lord, forgive me and accept my repentance; You are the Accepter of repentance, the Merciful.',ref:'Sunan Abi Dawud 1516; wording variants'},
{cat:'Protection',ar:'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',tr:'Bismillahil-ladhi la yadurru maasmihi shay’un fil-ardi wa la fis-sama’i wa huwas-Sami’ul-‘Alim',en:'In the name of Allah, with whose name nothing on earth or in heaven can cause harm; He is the All-Hearing, All-Knowing.',ref:'Sunan Abi Dawud 5088; Jami at-Tirmidhi 3388'},
{cat:'Protection',ar:'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',tr:'A‘udhu bi kalimatillahit-tammati min sharri ma khalaq',en:'I seek refuge in the perfect words of Allah from the evil of what He has created.',ref:'Sahih Muslim 2708'},
{cat:'Anxiety & hardship',ar:'لَا إِلَهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ',tr:'La ilaha illa anta subhanaka inni kuntu minaz-zalimin',en:'There is no deity except You; glory be to You. Indeed, I have been among the wrongdoers.',ref:'Quran 21:87'},
{cat:'Anxiety & hardship',ar:'رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي',tr:'Rabbishrah li sadri wa yassir li amri',en:'My Lord, expand for me my chest and make my task easy for me.',ref:'Quran 20:25–26'},
{cat:'Parents & family',ar:'رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا',tr:'Rabbirhamhuma kama rabbayani saghira',en:'My Lord, have mercy upon them as they brought me up when I was small.',ref:'Quran 17:24'},
{cat:'Parents & family',ar:'رَبَّنَا هَبْ لَنَا مِنْ أَزْوَاجِنَا وَذُرِّيَّاتِنَا قُرَّةَ أَعْيُنٍ',tr:'Rabbana hab lana min azwajina wa dhurriyyatina qurrata a‘yun',en:'Our Lord, grant us from our spouses and offspring comfort to our eyes.',ref:'Quran 25:74 (excerpt)'},
{cat:'Knowledge',ar:'رَبِّ زِدْنِي عِلْمًا',tr:'Rabbi zidni ilma',en:'My Lord, increase me in knowledge.',ref:'Quran 20:114'},
{cat:'Knowledge',ar:'اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا وَرِزْقًا طَيِّبًا وَعَمَلًا مُتَقَبَّلًا',tr:'Allahumma inni as’aluka ilman nafi‘an wa rizqan tayyiban wa amalan mutaqabbalan',en:'O Allah, I ask You for beneficial knowledge, good provision and accepted deeds.',ref:'Sunan Ibn Majah 925 (reported after Fajr)'},
{cat:'Food & drink',ar:'بِسْمِ اللَّهِ',tr:'Bismillah',en:'In the name of Allah.',ref:'Sahih al-Bukhari 5376; say before eating'},
{cat:'Food & drink',ar:'الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنِي هَذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ',tr:'Alhamdu lillahil-ladhi at‘amani hadha wa razaqanihi min ghayri hawlin minni wa la quwwah',en:'Praise belongs to Allah who fed me this and provided it for me without any power or strength from me.',ref:'Jami at-Tirmidhi 3458; check grading/wording by edition'},
{cat:'Entering & leaving home',ar:'بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',tr:'Bismillahi tawakkaltu ‘alallah wa la hawla wa la quwwata illa billah',en:'In the name of Allah; I place my trust in Allah. There is no power and no strength except through Allah.',ref:'Sunan Abi Dawud 5095; Jami at-Tirmidhi 3426'},
{cat:'Entering & leaving home',ar:'رَبِّ أَنْزِلْنِي مُنْزَلًا مُبَارَكًا وَأَنْتَ خَيْرُ الْمُنْزِلِينَ',tr:'Rabbi anzilni munzalan mubarakan wa anta khayrul-munzilin',en:'My Lord, let me land at a blessed landing place, and You are the best to accommodate.',ref:'Quran 23:29'},
{cat:'Travel',ar:'سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ',tr:'Subhanalladhi sakhkhara lana hadha wa ma kunna lahu muqrinin',en:'Glory be to the One who subjected this to us, and we could not have done it by ourselves.',ref:'Quran 43:13–14'},
{cat:'Travel',ar:'اللَّهُمَّ إِنَّا نَسْأَلُكَ فِي سَفَرِنَا هَذَا الْبِرَّ وَالتَّقْوَى',tr:'Allahumma inna nas’aluka fi safarina hadhal-birra wat-taqwa',en:'O Allah, we ask You on this journey for righteousness and piety.',ref:'Sahih Muslim 1342 (part of travel supplication)'},
{cat:'Sleep & waking',ar:'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا',tr:'Bismika Allahumma amutu wa ahya',en:'In Your name, O Allah, I die and I live.',ref:'Sahih al-Bukhari 6324'},
{cat:'Sleep & waking',ar:'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ',tr:'Alhamdu lillahil-ladhi ahyana ba‘da ma amatana wa ilayhin-nushur',en:'Praise belongs to Allah who gave us life after causing us to die, and to Him is the resurrection.',ref:'Sahih al-Bukhari 6312'},
{cat:'Salah & worship',ar:'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',tr:'Rabbana atina fid-dunya hasanatan wa fil-akhirati hasanatan wa qina adhaban-nar',en:'Our Lord, grant us good in this world and good in the Hereafter, and protect us from the punishment of the Fire.',ref:'Quran 2:201'},
{cat:'Salah & worship',ar:'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ',tr:'Allahumma a‘inni ‘ala dhikrika wa shukrika wa husni ‘ibadatik',en:'O Allah, help me remember You, thank You and worship You well.',ref:'Sunan Abi Dawud 1522; Sunan an-Nasa’i 1303'},
{cat:'Repentance',ar:'سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ أَشْهَدُ أَنْ لَا إِلَهَ إِلَّا أَنْتَ أَسْتَغْفِرُكَ وَأَتُوبُ إِلَيْكَ',tr:'Subhanaka Allahumma wa bihamdika, ash-hadu an la ilaha illa anta, astaghfiruka wa atubu ilayk',en:'Glory and praise be to You, O Allah. I testify there is no deity but You; I seek Your forgiveness and repent to You.',ref:'Sunan Abi Dawud 4859; Jami at-Tirmidhi 3433'},
{cat:'Gratitude',ar:'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',tr:'Alhamdu lillahi Rabbil-‘alamin',en:'All praise belongs to Allah, Lord of all worlds.',ref:'Quran 1:2'},
{cat:'Gratitude',ar:'رَبِّ أَوْزِعْنِي أَنْ أَشْكُرَ نِعْمَتَكَ',tr:'Rabbi awzi‘ni an ashkura ni‘matak',en:'My Lord, enable me to be grateful for Your favor.',ref:'Quran 27:19 (excerpt)'},
{cat:'Entering the mosque',ar:'اللَّهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ',tr:'Allahummaftah li abwaba rahmatik',en:'O Allah, open for me the gates of Your mercy.',ref:'Sahih Muslim 713'},
{cat:'Leaving the mosque',ar:'اللَّهُمَّ إِنِّي أَسْأَلُكَ مِنْ فَضْلِكَ',tr:'Allahumma inni as’aluka min fadlik',en:'O Allah, I ask You from Your bounty.',ref:'Sahih Muslim 713'},
{cat:'Distress',ar:'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ',tr:'Hasbunallahu wa ni‘mal-wakil',en:'Allah is sufficient for us, and He is the best disposer of affairs.',ref:'Quran 3:173'},
{cat:'Guidance',ar:'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ',tr:'Ihdinas-siratal-mustaqim',en:'Guide us to the straight path.',ref:'Quran 1:6'},
{cat:'Protection',ar:'قُلْ هُوَ اللَّهُ أَحَدٌ',tr:'Qul huwallahu ahad',en:'Say: He is Allah, the One.',ref:'Quran 112:1; Surah al-Ikhlas is part of established morning/evening recitations'},
{cat:'Repentance',ar:'رَبَّنَا اغْفِرْ لَنَا ذُنُوبَنَا وَإِسْرَافَنَا فِي أَمْرِنَا',tr:'Rabbana ighfir lana dhunubana wa israfana fi amrina',en:'Our Lord, forgive us our sins and excesses in our affairs.',ref:'Quran 3:147 (excerpt)'},
{cat:'Patience',ar:'رَبَّنَا أَفْرِغْ عَلَيْنَا صَبْرًا وَتَوَفَّنَا مُسْلِمِينَ',tr:'Rabbana afrigh ‘alayna sabran wa tawaffana muslimin',en:'Our Lord, pour upon us patience and let us die as Muslims.',ref:'Quran 7:126 (excerpt)'},
{cat:'Provision',ar:'رَبِّ إِنِّي لِمَا أَنْزَلْتَ إِلَيَّ مِنْ خَيْرٍ فَقِيرٌ',tr:'Rabbi inni lima anzalta ilayya min khayrin faqir',en:'My Lord, I am in need of whatever good You send down to me.',ref:'Quran 28:24'},
{cat:'Health & well-being',ar:'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ',tr:'Allahumma inni as’alukal-‘afwa wal-‘afiyah',en:'O Allah, I ask You for pardon and well-being.',ref:'Sunan Abi Dawud 5074; Jami at-Tirmidhi 3512'},
{cat:'Health & well-being',ar:'أَذْهِبِ الْبَأْسَ رَبَّ النَّاسِ وَاشْفِ أَنْتَ الشَّافِي',tr:'Adhhib al-ba’s Rabb an-nas washfi Antash-Shafi',en:'Remove the harm, Lord of mankind, and heal; You are the Healer.',ref:'Sahih al-Bukhari 5743; Sahih Muslim 2191 (wording variants)'},
{cat:'Before sleep',ar:'اللَّهُمَّ قِنِي عَذَابَكَ يَوْمَ تَبْعَثُ عِبَادَكَ',tr:'Allahumma qini ‘adhabaka yawma tab‘athu ‘ibadak',en:'O Allah, protect me from Your punishment on the Day You resurrect Your servants.',ref:'Sunan Abi Dawud 5045; Jami at-Tirmidhi 3398'},
{cat:'Family',ar:'رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا',tr:'Rabbana la tuzigh qulubana ba‘da idh hadaytana',en:'Our Lord, do not let our hearts deviate after You have guided us.',ref:'Quran 3:8'},
{cat:'Entering & leaving home',ar:'السَّلَامُ عَلَيْكُمْ',tr:'As-salamu alaykum',en:'Peace be upon you.',ref:'Quran 24:27; greeting etiquette is detailed in hadith collections'},
{cat:'Rain',ar:'اللَّهُمَّ صَيِّبًا نَافِعًا',tr:'Allahumma sayyiban nafi‘a',en:'O Allah, make it a beneficial rain.',ref:'Sahih al-Bukhari 1032'},
{cat:'After rain',ar:'مُطِرْنَا بِفَضْلِ اللَّهِ وَرَحْمَتِهِ',tr:'Mutirna bi fadlillahi wa rahmatih',en:'We have been given rain by the grace and mercy of Allah.',ref:'Sahih al-Bukhari 846; Sahih Muslim 71'},
{cat:'Anger',ar:'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ',tr:'A‘udhu billahi minash-shaytanir-rajim',en:'I seek refuge in Allah from Satan, the accursed.',ref:'Quran 16:98; Sahih al-Bukhari 3282, Sahih Muslim 2610'},
{cat:'Knowledge',ar:'اللَّهُمَّ انْفَعْنِي بِمَا عَلَّمْتَنِي وَعَلِّمْنِي مَا يَنْفَعُنِي وَزِدْنِي عِلْمًا',tr:'Allahummanfa‘ni bima ‘allamtani wa ‘allimni ma yanfa‘uni wa zidni ‘ilma',en:'O Allah, benefit me with what You have taught me, teach me what benefits me, and increase me in knowledge.',ref:'Jami at-Tirmidhi 3599; check grading by edition'},
{cat:'Good character',ar:'اللَّهُمَّ اهْدِنِي لِأَحْسَنِ الْأَخْلَاقِ',tr:'Allahumma ihdini li-ahsanil-akhlaq',en:'O Allah, guide me to the best of character.',ref:'Sahih Muslim 771 (related supplication; wording shortened)'},
{cat:'Waking up',ar:'الْحَمْدُ لِلَّهِ الَّذِي عَافَانِي فِي جَسَدِي وَرَدَّ عَلَيَّ رُوحِي وَأَذِنَ لِي بِذِكْرِهِ',tr:'Alhamdu lillahil-ladhi ‘afani fi jasadi wa radda ‘alayya ruhi wa adhina li bidhikrih',en:'Praise belongs to Allah who restored well-being to my body, returned my soul to me and permitted me to remember Him.',ref:'Jami at-Tirmidhi 3401; verify wording/grade by edition'},
{cat:'Salah & worship',ar:'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',tr:'SubhanAllahi wa bihamdih',en:'Glory and praise be to Allah.',ref:'Sahih al-Bukhari 6405; Sahih Muslim 2691'},
{cat:'Salah & worship',ar:'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',tr:'La hawla wa la quwwata illa billah',en:'There is no power and no strength except through Allah.',ref:'Sahih al-Bukhari 6384; Sahih Muslim 2704'},
{cat:'Forgiveness',ar:'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ',tr:'Astaghfirullaha wa atubu ilayh',en:'I seek Allah’s forgiveness and repent to Him.',ref:'Sahih al-Bukhari 6307; wording appears in multiple reports'},
{cat:'Goodness',ar:'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْهُدَى وَالتُّقَى وَالْعَفَافَ وَالْغِنَى',tr:'Allahumma inni as’alukal-huda wat-tuqa wal-‘afafa wal-ghina',en:'O Allah, I ask You for guidance, piety, chastity and self-sufficiency.',ref:'Sahih Muslim 2721'},
{cat:'Entering & leaving home',ar:'غُفْرَانَكَ',tr:'Ghufranak',en:'I seek Your forgiveness.',ref:'Sunan Abi Dawud 30; Jami at-Tirmidhi 7 (upon leaving the toilet)'},
{cat:'Salah & worship',ar:'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ',tr:'Allahumma salli ‘ala Muhammad',en:'O Allah, send blessings upon Muhammad.',ref:'Quran 33:56; detailed wording in Sahih al-Bukhari 3370'},
{cat:'Forgiveness',ar:'رَبَّنَا تَقَبَّلْ مِنَّا إِنَّكَ أَنْتَ السَّمِيعُ الْعَلِيمُ',tr:'Rabbana taqabbal minna innaka Antas-Sami‘ul-‘Alim',en:'Our Lord, accept this from us. You are the All-Hearing, All-Knowing.',ref:'Quran 2:127'},
{cat:'Goodness',ar:'رَبَّنَا عَلَيْكَ تَوَكَّلْنَا وَإِلَيْكَ أَنَبْنَا وَإِلَيْكَ الْمَصِيرُ',tr:'Rabbana ‘alayka tawakkalna wa ilayka anabna wa ilaykal-masir',en:'Our Lord, upon You we rely, to You we turn, and to You is the final return.',ref:'Quran 60:4'},
{cat:'Repentance',ar:'رَبِّ اغْفِرْ وَارْحَمْ وَأَنْتَ خَيْرُ الرَّاحِمِينَ',tr:'Rabbighfir warham wa Anta khayrur-rahimin',en:'My Lord, forgive and have mercy, and You are the best of the merciful.',ref:'Quran 23:118'},
{cat:'Distress',ar:'إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ',tr:'Inna lillahi wa inna ilayhi raji‘un',en:'Indeed, we belong to Allah, and indeed to Him we will return.',ref:'Quran 2:156'},
{cat:'Salah & worship',ar:'رَبِّ أَعِنِّي وَلَا تُعِنْ عَلَيَّ',tr:'Rabbi a‘inni wa la tu‘in ‘alayya',en:'My Lord, help me and do not help against me.',ref:'Sunan Abi Dawud 1510 (part of a longer supplication; verify wording)'},
{cat:'Patience',ar:'إِنَّ اللَّهَ مَعَ الصَّابِرِينَ',tr:'Innallaha ma‘as-sabirin',en:'Indeed, Allah is with the patient.',ref:'Quran 2:153 (Quranic remembrance, not a standalone prophetic dua)'}
];
async function initDuas(){
 const list=$('dua-list'), cat=$('dua-category'), search=$('dua-search');if(!list||!cat)return;
 const fillCategories=()=>{const current=cat.value;cat.innerHTML='<option value="all">All categories</option>';[...new Set(duas.map(d=>d.cat).filter(Boolean))].sort().forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;cat.append(o);});if([...cat.options].some(o=>o.value===current))cat.value=current;};
 const render=()=>{const q=(search.value||'').toLowerCase(), c=cat.value;const found=duas.filter(d=>(c==='all'||d.cat===c)&&[d.cat,d.ar,d.tr,d.en,d.ref].join(' ').toLowerCase().includes(q));$('dua-count').textContent=`Showing ${found.length} of ${duas.length} duas`;list.innerHTML=found.map(d=>`<article class="card"><span class="tag">${esc(d.cat)}</span>${arabicText(d.ar)}<p class="transliteration">${esc(d.tr||'')}</p><p>${esc(d.en)}</p><div class="ref">Reference: ${esc(d.ref||'See source')}</div></article>`).join('')||'<p class="muted">No duas match your search.</p>';};
 cat.addEventListener('change',render);search.addEventListener('input',render);fillCategories();render();
 try {
  const payload=await safeJson('https://ummahapi.com/api/duas');
  const incoming=Array.isArray(payload)?payload:(Array.isArray(payload.data)?payload.data:(Array.isArray(payload.duas)?payload.duas:[]));
  const seen=new Set(duas.map(d=>(d.ar||'').replace(/\s/g,'')+'|'+(d.ref||'')));
  incoming.forEach((x,i)=>{
   const ar=x.arabic||x.ar||x.text_ar||x.arabic_text||'';
   const en=x.translation||x.english||x.meaning||x.text_en||'';
   if(!ar||!en)return;
   const ref=x.reference||x.source||x.hadith_reference||x.quran_reference||'Source listed by UmmahAPI';
   const key=ar.replace(/\s/g,'')+'|'+ref;if(seen.has(key))return;seen.add(key);
   duas.push({cat:x.category||x.category_name||x.section||'Additional duas',ar,tr:x.transliteration||x.transliteration_en||x.transliteration_latin||'',en,ref});
  });
  fillCategories();render();
 } catch(e) { $('dua-count').textContent=`Showing ${duas.length} built-in duas. Online collection could not be loaded; check your connection.`; }
}
const NAMES=[
['الرَّحْمَٰن','Ar-Rahman','The Most Merciful'],['الرَّحِيم','Ar-Raheem','The Especially Merciful'],['الْمَلِك','Al-Malik','The King'],['الْقُدُّوس','Al-Quddus','The Most Holy'],['السَّلَام','As-Salam','The Source of Peace'],['الْمُؤْمِن','Al-Mu’min','The Giver of Security'],['الْمُهَيْمِن','Al-Muhaymin','The Guardian'],['الْعَزِيز','Al-Aziz','The Almighty'],['الْجَبَّار','Al-Jabbar','The Compeller'],['الْمُتَكَبِّر','Al-Mutakabbir','The Supremely Great'],['الْخَالِق','Al-Khaliq','The Creator'],['الْبَارِئ','Al-Bari','The Originator'],['الْمُصَوِّر','Al-Musawwir','The Fashioner'],['الْغَفَّار','Al-Ghaffar','The Constant Forgiver'],['الْقَهَّار','Al-Qahhar','The All-Prevailing'],['الْوَهَّاب','Al-Wahhab','The Bestower'],['الرَّزَّاق','Ar-Razzaq','The Provider'],['الْفَتَّاح','Al-Fattah','The Opener'],['الْعَلِيم','Al-Alim','The All-Knowing'],['الْقَابِض','Al-Qabid','The Withholder'],['الْبَاسِط','Al-Basit','The Expander'],['الْخَافِض','Al-Khafid','The One who lowers'],['الرَّافِع','Ar-Rafi','The One who raises'],['الْمُعِزّ','Al-Mu’izz','The Giver of Honor'],['الْمُذِلّ','Al-Mudhill','The One who humbles'],['السَّمِيع','As-Sami','The All-Hearing'],['الْبَصِير','Al-Basir','The All-Seeing'],['الْحَكَم','Al-Hakam','The Judge'],['الْعَدْل','Al-Adl','The Utterly Just'],['اللَّطِيف','Al-Latif','The Most Subtle'],['الْخَبِير','Al-Khabir','The All-Aware'],['الْحَلِيم','Al-Halim','The Most Forbearing'],['الْعَظِيم','Al-Azim','The Magnificent'],['الْغَفُور','Al-Ghafur','The All-Forgiving'],['الشَّكُور','Ash-Shakur','The Most Appreciative'],['الْعَلِيّ','Al-Ali','The Most High'],['الْكَبِير','Al-Kabir','The Most Great'],['الْحَفِيظ','Al-Hafiz','The Preserver'],['الْمُقِيت','Al-Muqit','The Sustainer'],['الْحَسِيب','Al-Hasib','The Reckoner'],['الْجَلِيل','Al-Jalil','The Majestic'],['الْكَرِيم','Al-Karim','The Most Generous'],['الرَّقِيب','Ar-Raqib','The Watchful'],['الْمُجِيب','Al-Mujib','The Responsive'],['الْوَاسِع','Al-Wasi','The All-Encompassing'],['الْحَكِيم','Al-Hakim','The All-Wise'],['الْوَدُود','Al-Wadud','The Most Loving'],['الْمَجِيد','Al-Majid','The Most Glorious'],['الْبَاعِث','Al-Ba’ith','The Resurrector'],['الشَّهِيد','Ash-Shahid','The Witness'],['الْحَقّ','Al-Haqq','The Absolute Truth'],['الْوَكِيل','Al-Wakil','The Trustee'],['الْقَوِيّ','Al-Qawiyy','The All-Strong'],['الْمَتِين','Al-Matin','The Firm'],['الْوَلِيّ','Al-Waliyy','The Protecting Friend'],['الْحَمِيد','Al-Hamid','The Praiseworthy'],['الْمُحْصِي','Al-Muhsi','The All-Enumerating'],['الْمُبْدِئ','Al-Mubdi','The Initiator'],['الْمُعِيد','Al-Mu’id','The Restorer'],['الْمُحْيِي','Al-Muhyi','The Giver of Life'],['الْمُمِيت','Al-Mumit','The Bringer of Death'],['الْحَيّ','Al-Hayy','The Ever-Living'],['الْقَيُّوم','Al-Qayyum','The Self-Subsisting'],['الْوَاجِد','Al-Wajid','The Finder'],['الْمَاجِد','Al-Maajid','The Noble'],['الْوَاحِد','Al-Wahid','The One'],['الصَّمَد','As-Samad','The Eternal Refuge'],['الْقَادِر','Al-Qadir','The All-Powerful'],['الْمُقْتَدِر','Al-Muqtadir','The Omnipotent'],['الْمُقَدِّم','Al-Muqaddim','The One who brings forward'],['الْمُؤَخِّر','Al-Mu’akhkhir','The One who delays'],['الأَوَّل','Al-Awwal','The First'],['الآخِر','Al-Akhir','The Last'],['الظَّاهِر','Az-Zahir','The Manifest'],['الْبَاطِن','Al-Batin','The Hidden'],['الْوَالِي','Al-Wali','The Governor'],['الْمُتَعَالِي','Al-Muta’ali','The Most Exalted'],['الْبَرّ','Al-Barr','The Source of Goodness'],['التَّوَّاب','At-Tawwab','The Accepter of Repentance'],['الْمُنْتَقِم','Al-Muntaqim','The Just Requiter'],['العَفُوّ','Al-Afuww','The Pardoner'],['الرَّؤُوف','Ar-Ra’uf','The Most Kind'],['مَالِكُ الْمُلْك','Malik-ul-Mulk','Master of the Kingdom'],['ذُو الْجَلَالِ وَالْإِكْرَام','Dhul-Jalali wal-Ikram','Possessor of Majesty and Honor'],['الْمُقْسِط','Al-Muqsit','The Equitable'],['الْجَامِع','Al-Jami','The Gatherer'],['الْغَنِيّ','Al-Ghani','The Self-Sufficient'],['الْمُغْنِي','Al-Mughni','The Enricher'],['الْمَانِع','Al-Mani','The Preventer'],['الضَّارّ','Ad-Darr','The One who allows adversity'],['النَّافِع','An-Nafi','The One who grants benefit'],['النُّور','An-Nur','The Light'],['الْهَادِي','Al-Hadi','The Guide'],['الْبَدِيع','Al-Badi','The Incomparable Originator'],['الْبَاقِي','Al-Baqi','The Everlasting'],['الْوَارِث','Al-Warith','The Inheritor'],['الرَّشِيد','Ar-Rashid','The Guide to the Right Path'],['الصَّبُور','As-Sabur','The Most Patient']];
function initNames(){const el=$('names-list'),search=$('name-search');if(!el)return;const render=()=>{let q=(search?.value||'').toLowerCase();el.innerHTML=NAMES.filter(n=>n.join(' ').toLowerCase().includes(q)).map((n,i)=>`<article class="card"><span class="tag">${i+1}</span><div class="arabic">${esc(n[0])}</div><h3>${esc(n[1])}</h3><p>${esc(n[2])}</p></article>`).join('');};search?.addEventListener('input',render);render();}
const PROPHETS=[
['Adam','Quran 2:30–39; 7:11–27','The first human and prophet; the Quran describes his creation, his experience in the Garden and his repentance.'],
['Idris','Quran 19:56–57; 21:85','Described in the Quran as truthful and a prophet, and raised to a high station.'],
['Nuh (Noah)','Quran 11:25–49; Surah 71','Called his people to worship Allah and remained patient through a long mission.'],
['Hud','Quran 7:65–72; 11:50–60','Sent to the people of ‘Ad, calling them away from arrogance and toward worship of Allah.'],
['Salih','Quran 7:73–79; 11:61–68','Sent to Thamud, whose people were tested with the she-camel sign.'],
['Ibrahim (Abraham)','Quran 6:74–83; 14:35–41; 37:99–113','A model of tawhid, devotion, trust in Allah and hospitality.'],
['Lut (Lot)','Quran 7:80–84; 11:77–83','Called his people to righteousness and warned them against grave wrongdoing.'],
['Ismail (Ishmael)','Quran 19:54–55; 37:100–107','Remembered for keeping his promise and for submission to Allah.'],
['Ishaq (Isaac)','Quran 11:71–73; 37:112–113','A prophet and part of the blessed family of Ibrahim.'],
['Yaqub (Jacob)','Quran 12:6; 12:83–87','A prophet whose story highlights patience, hope and reliance upon Allah.'],
['Yusuf (Joseph)','Surah 12','His story teaches patience, chastity, forgiveness and trust in Allah through hardship.'],
['Ayyub (Job)','Quran 21:83–84; 38:41–44','A model of patience and turning to Allah during severe trial.'],
['Shuayb','Quran 7:85–93; 11:84–95','Called his people to worship Allah and deal honestly in trade.'],
['Musa (Moses)','Quran 20; 28; 7:103–137','His story includes confronting Pharaoh, receiving revelation and leading the Children of Israel.'],
['Harun (Aaron)','Quran 20:29–36; 20:90–94','Musa’s brother and a prophet who helped deliver the message.'],
['Dhul-Kifl','Quran 21:85–86; 38:48','Mentioned among the patient and righteous; details are limited in the Quran.'],
['Dawud (David)','Quran 2:251; 38:17–26','A prophet and king who was given the Zabur and instructed to judge with justice.'],
['Sulayman (Solomon)','Quran 27; 34:12–14; 38:30–40','A prophet and king who was grateful for Allah’s gifts and authority.'],
['Ilyas (Elijah)','Quran 6:85; 37:123–132','Called his people to worship Allah alone.'],
['Al-Yasa (Elisha)','Quran 6:86; 38:48','Named among the righteous; the Quran gives limited narrative detail.'],
['Yunus (Jonah)','Quran 10:98; 21:87–88; Surah 37:139–148','His story highlights repentance, supplication and Allah’s mercy.'],
['Zakariyya (Zechariah)','Quran 3:37–41; 19:2–11','Prayed sincerely for a righteous heir and was given glad tidings of Yahya.'],
['Yahya (John)','Quran 3:39; 19:12–15','Described as virtuous, compassionate and dutiful to his parents.'],
['Isa (Jesus)','Quran 3:45–55; 5:110–120; 19:16–36','The Messiah and messenger of Allah, born to Maryam by Allah’s command; Muslims do not regard him as divine.'],
['Muhammad ﷺ','Quran 33:40; 48:29; 68:4','The final prophet and messenger, sent as a mercy to the worlds. Quran 21:107.']
];
function initProphets(){const el=$('prophets-list');if(!el)return;el.innerHTML=PROPHETS.map((p,i)=>`<article class="card"><span class="tag">Prophet ${i+1} of ${PROPHETS.length} listed</span><h3>${esc(p[0])}</h3><p>${esc(p[2])}</p><div class="ref">${esc(p[1])}</div></article>`).join('');}
function initCalendar(){const h=$('hijri-date');if(!h)return;const now=new Date();try{h.textContent=new Intl.DateTimeFormat('en-u-ca-islamic', {day:'numeric',month:'long',year:'numeric'}).format(now);}catch(e){h.textContent='Hijri calendar not supported by this browser';}if($('gregorian-date'))$('gregorian-date').textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'full'}).format(now);}
function initTasbeeh(){const c=$('tasbeeh-count');if(!c)return;let n=0;const show=()=>c.textContent=n;$('tasbeeh-add').onclick=()=>{n++;show();};$('tasbeeh-reset').onclick=()=>{n=0;show();};}
const KAABA={lat:21.422487,long:39.826206};
function bearing(lat,lon){const toRad=x=>x*Math.PI/180, toDeg=x=>x*180/Math.PI;const p1=toRad(lat),p2=toRad(KAABA.lat),dl=toRad(KAABA.long-lon);return (toDeg(Math.atan2(Math.sin(dl),Math.cos(p1)*Math.tan(p2)-Math.sin(p1)*Math.cos(dl)))+360)%360;}
function getGPS(onOK,onError){if(!navigator.geolocation){onError('This browser does not support location access.');return;}navigator.geolocation.getCurrentPosition(p=>onOK({lat:p.coords.latitude,lon:p.coords.longitude,label:`Device location (${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)})`}),e=>onError(e.code===1?'Location permission was denied. Enter a city instead.':'Could not get your location. Check device location settings and try again.'),{enableHighAccuracy:true,timeout:12000,maximumAge:300000});}
async function geocode(city){const u='https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(city);const r=await fetch(u,{headers:{'Accept-Language':'en'}});if(!r.ok)throw Error('City lookup failed');const d=await r.json();if(!d.length)throw Error('No matching city found. Try adding state and country.');return {lat:Number(d[0].lat),lon:Number(d[0].lon),label:d[0].display_name};}
function initQibla(){const status=$('qibla-status');if(!status)return;const update=loc=>{const b=bearing(loc.lat,loc.lon);$('qibla-degrees').textContent=`${b.toFixed(1)}°`; $('qibla-needle').style.transform=`rotate(${b}deg)`;showStatus(status,`Location: ${loc.label}. Qibla bearing: ${b.toFixed(1)}° clockwise from true north.`);};$('qibla-gps').onclick=()=>getGPS(update,e=>showStatus(status,e,true));$('qibla-search').onclick=async()=>{try{showStatus(status,'Finding city…');update(await geocode($('qibla-city').value.trim()));}catch(e){showStatus(status,e.message,true);}};}
async function initPrayer(){
 const status=$('prayer-status'), locationBox=$('prayer-location'), times=$('prayer-times');if(!status||!times)return;let loc=null;
 const loadLib=async()=>{if(window.adhan)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://unpkg.com/adhan@4.4.6/lib/bundles/adhan.umd.min.js';s.onload=resolve;s.onerror=()=>reject(Error('Prayer calculation library did not load'));document.head.appendChild(s);});};
 const calc=async()=>{
  if(!loc){showStatus(status,'Choose your location first.');return;}
  try{
   showStatus(status,'Calculating…');await loadLib();const A=window.adhan;if(!A)throw Error('Prayer calculation library unavailable');
   const methods={Karachi:A.CalculationMethod.Karachi,MuslimWorldLeague:A.CalculationMethod.MuslimWorldLeague,Egyptian:A.CalculationMethod.Egyptian,UmmAlQura:A.CalculationMethod.UmmAlQura,NorthAmerica:A.CalculationMethod.NorthAmerica,Dubai:A.CalculationMethod.Dubai,Kuwait:A.CalculationMethod.Kuwait,Qatar:A.CalculationMethod.Qatar,Singapore:A.CalculationMethod.Singapore,Turkey:A.CalculationMethod.Turkey};
   const params=(methods[$('calc-method').value]||A.CalculationMethod.Karachi)();
   params.madhab=$('asr-method').value==='Hanafi'?A.Madhab.Hanafi:A.Madhab.Shafi;
   if(A.HighLatitudeRule)params.highLatitudeRule=A.HighLatitudeRule.MiddleOfTheNight;
   const date=new Date();date.setHours(0,0,0,0);
   const coordinates=new A.Coordinates(loc.lat,loc.lon);const prayerTimes=new A.PrayerTimes(coordinates,date,params);
   const adjustment=id=>Number($(id)?.value||0);
   const addMinutes=(time,minutes)=>new Date(time.getTime()+minutes*60000);
   const rows=[['Fajr',addMinutes(prayerTimes.fajr,adjustment('fajr-adjust'))],['Sunrise',prayerTimes.sunrise],['Dhuhr',addMinutes(prayerTimes.dhuhr,adjustment('dhuhr-adjust'))],['Asr',addMinutes(prayerTimes.asr,adjustment('asr-adjust'))],['Maghrib',addMinutes(prayerTimes.maghrib,adjustment('maghrib-adjust'))],['Isha',addMinutes(prayerTimes.isha,adjustment('isha-adjust'))]];
   times.innerHTML=rows.map(([name,time])=>`<div class="prayer-time"><span class="muted">${name}</span><strong>${fmtTime(time)}</strong></div>`).join('');
   const method=$('calc-method').selectedOptions[0].textContent;
   showStatus(status,`${date.toLocaleDateString()} · ${method} · ${$('asr-method').value} Asr · Local device time zone.`);
  }catch(e){showStatus(status,'Unable to calculate prayer times. Check your connection and try again.',true);}
 };
 const setLoc=x=>{loc=x;showStatus(locationBox,`Location: ${x.label} · ${x.lat.toFixed(4)}, ${x.lon.toFixed(4)}`);calc();};
 $('use-gps').onclick=()=>getGPS(setLoc,e=>showStatus(locationBox,e,true));
 $('search-city').onclick=async()=>{try{const city=$('city-input').value.trim();if(!city)throw Error('Enter a city name.');showStatus(locationBox,'Finding location…');setLoc(await geocode(city));}catch(e){showStatus(locationBox,e.message,true);}};
 $('calc-method').onchange=calc;$('asr-method').onchange=calc;
 ['fajr-adjust','dhuhr-adjust','asr-adjust','maghrib-adjust','isha-adjust'].forEach(id=>$(id)?.addEventListener('change',calc));
}
function initSettings(){const scale=$('font-scale'), motion=$('reduce-motion');if(!scale)return;try{const p=JSON.parse(localStorage.getItem('sn-settings')||'{}');if(p.font)scale.value=p.font;if(p.motion)motion.checked=true;document.documentElement.style.fontSize=(scale.value||16)+'px';}catch(e){}$('save-settings').onclick=()=>{const p={font:scale.value,motion:motion.checked};localStorage.setItem('sn-settings',JSON.stringify(p));document.documentElement.style.fontSize=scale.value+'px';document.documentElement.style.scrollBehavior=motion.checked?'auto':'smooth';$('settings-status').textContent='Preferences saved in this browser.';};}
const QUIZ=[
{q:'Which Surah opens the Quran?',o:['Al-Baqarah','Al-Fatihah','Al-Ikhlas','An-Nas'],a:1,ref:'Quran, Surah al-Fatihah.'},
{q:'Which angel brought revelation to the prophets?',o:['Mikail','Israfil','Jibril','Malik'],a:2,ref:'Jibril is associated with bringing revelation; see Quran 2:97.'},
{q:'How many obligatory daily prayers are there?',o:['Three','Four','Five','Six'],a:2,ref:'The five daily prayers are established in the Sunnah.'},
{q:'Which prophet built the Ark by Allah’s command?',o:['Musa','Nuh','Yusuf','Dawud'],a:1,ref:'Quran 11:37–44.'},
{q:'Which month is the month of fasting?',o:['Muharram','Rajab','Ramadan','Shawwal'],a:2,ref:'Quran 2:183–185.'},
{q:'What is the direction Muslims face in prayer called?',o:['Mihrab','Qibla','Minbar','Maqam'],a:1,ref:'Quran 2:144.'},
{q:'Which prophet is known for interpreting the king’s dream in Surah Yusuf?',o:['Yusuf','Ibrahim','Yunus','Sulayman'],a:0,ref:'Quran, Surah Yusuf.'},
{q:'What is the first month of the Hijri calendar?',o:['Ramadan','Safar','Muharram','Dhul Hijjah'],a:2,ref:'Muharram is the first month of the Hijri calendar.'}
];
function initQuiz(){const q=$('quiz-question');if(!q)return;let idx=0,score=0,answered=false;const render=()=>{answered=false;const d=QUIZ[idx];$('quiz-progress').textContent=`Question ${idx+1} of ${QUIZ.length}`;q.textContent=d.q;$('quiz-options').innerHTML=d.o.map((o,i)=>`<button class="secondary" data-i="${i}" style="text-align:left">${esc(o)}</button>`).join('');$('quiz-feedback').classList.add('hidden');$('quiz-next').classList.add('hidden');$('quiz-score').textContent=`Score: ${score}`;$('quiz-options').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(answered)return;answered=true;const good=Number(b.dataset.i)===d.a;if(good)score++;showStatus($('quiz-feedback'),`${good?'Correct.':'Not quite.'} ${d.ref}`);$('quiz-feedback').classList.remove('hidden');$('quiz-score').textContent=`Score: ${score}`;$('quiz-next').classList.remove('hidden');});};$('quiz-next').onclick=()=>{idx++;if(idx>=QUIZ.length){q.textContent=`Quiz complete — ${score}/${QUIZ.length}`;$('quiz-options').innerHTML='';$('quiz-next').classList.add('hidden');$('quiz-progress').textContent='Completed';$('quiz-score').textContent='Review the references above, then try again.';}else render();};$('quiz-restart').onclick=()=>{idx=0;score=0;render();};render();}

async function initHomeDaily(){
 if(!$('daily-ayah-ar')&&!$('daily-hadith-ar'))return;
 try{
  const now=new Date();const surah=((now.getUTCDate()+now.getUTCMonth()*3)%114)+1;
  const list=await safeJson(`https://api.alquran.cloud/v1/surah/${surah}/ayahs/quran-uthmani`);
  const ayahs=list.data||[];if(ayahs.length){const item=ayahs[(now.getUTCDate()-1)%ayahs.length];const en=await safeJson(`https://api.alquran.cloud/v1/ayah/${item.number}/en.hilali`);if($('daily-ayah-ar'))$('daily-ayah-ar').textContent=item.text;if($('daily-ayah-en'))$('daily-ayah-en').textContent=en.data.text;if($('daily-ayah-ref'))$('daily-ayah-ref').textContent=`${item.surah.englishName} ${item.surah.number}:${item.numberInSurah}`;}
 }catch(e){}
 try{
  const d=await loadHadithData('bukhari');const recs=d.metadata.records||[];if(recs.length){const day=Math.floor(Date.now()/86400000);const n=day%recs.length;const h=await getHadith('bukhari',recs[n].num||n+1);if($('daily-hadith-ar'))$('daily-hadith-ar').textContent=h.ar||'';if($('daily-hadith-en'))$('daily-hadith-en').textContent=h.en||'';if($('daily-hadith-ref'))$('daily-hadith-ref').textContent=`${COLLECTIONS.bukhari} ${h.rec.num||n+1}`;}
 }catch(e){}
}
document.addEventListener('DOMContentLoaded',()=>{
 initHadith();initQuran();initDuas();initNames();initCalendar();initTasbeeh();initQibla();initPrayer();initSettings();initProphets();initQuiz();initHomeDaily();
});
})();
