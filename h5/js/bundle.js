/** 每日打卡 - 完整应用 (合并版) **/

// ==================== 工具函数 ====================
const Utils = {
    formatDate(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}:${minute}`;
    },
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    },
    formatDuration(seconds) {
        if (!seconds && seconds !== 0) return '';
        const s = parseInt(seconds);
        if (isNaN(s)) return seconds;
        if (s < 60) return `${s}秒`;
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${mins}分${secs > 0 ? secs + '秒' : ''}`;
    },
    parseDuration(str) {
        if (!str || typeof str === 'number') return str ? parseInt(str) : 0;
        let total = 0;
        const m = String(str).match(/(\d+)\s*分/);
        if (m) total += parseInt(m[1]) * 60;
        const s = String(str).match(/(\d+)\s*秒/);
        if (s) total += parseInt(s[1]);
        return total || 0;
    },
    showToast(message, duration = 2000) {
        let toast = document.getElementById('toast');
        if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.className = 'toast'; document.body.appendChild(toast); }
        toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), duration);
    },
    showConfirm(title, content, onConfirm, onCancel, confirmText = '确定', cancelText = '取消', isDanger = false) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-content"><div class="modal-title">${title}</div><div class="modal-text">${content}</div><div class="modal-buttons"><button class="modal-btn cancel">${cancelText}</button><button class="modal-btn confirm ${isDanger ? 'danger' : ''}">${confirmText}</button></div></div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));
        overlay.querySelector('.cancel').addEventListener('click', () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 300); if (onCancel) onCancel(); });
        overlay.querySelector('.confirm').addEventListener('click', () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 300); if (onConfirm) onConfirm(); });
    },
    calculateStreak(records) {
        if (records.length === 0) return 0;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (!records.some(r => new Date(r.createTime).toDateString() === today.toDateString())) today.setDate(today.getDate() - 1);
        let streak = 0;
        while (true) { if (records.some(r => new Date(r.createTime).toDateString() === today.toDateString())) { streak++; today.setDate(today.getDate() - 1); } else break; }
        return streak;
    }
};

// ==================== 云端存储（Supabase）+ 文件存储 ====================
const SUPABASE_URL = 'https://rrmghbykyvflxqwvgqhu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ebGMg1GJQQuUkfnRNzxCFA_Bfy1iPWV';
const STORAGE_BUCKET = 'media';
let _supabaseClient = null;

function _getSupabase() {
    if (!_supabaseClient && typeof supabase !== 'undefined') _supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return _supabaseClient;
}

// dataURL -> File (支持大文件分块解码)
function _dataURLtoFile(dataUrl, filename) {
    try {
        const arr = dataUrl.split(',');
        if (arr.length < 2) { console.warn('[dataURLtoFile] 格式错误: 无逗号分隔'); return null; }
        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) { console.warn('[dataURLtoFile] 无法识别MIME类型:', arr[0].substring(0, 50)); return null; }
        const mime = mimeMatch[1];
        const b64 = arr[1];
        // 分块解码避免大文件卡死主线程
        const CHUNK = 512 * 1024; // 512KB per chunk
        const totalLen = b64.length;
        const u8arr = new Uint8Array(totalLen * 0.75 >> 0);
        let writePos = 0;
        for (let offset = 0; offset < totalLen; offset += CHUNK) {
            const chunk = b64.substring(offset, Math.min(offset + CHUNK, totalLen));
            const raw = atob(chunk);
            for (let j = 0; j < raw.length; j++) u8arr[writePos++] = raw.charCodeAt(j);
        }
        // 精确截取实际长度
        const exactArr = u8arr.subarray(0, writePos);
        return new File([exactArr], filename, { type: mime });
    } catch(e) {
        console.error('[dataURLtoFile] 转换异常:', e.message, 'filename:', filename, 'dataUrl长度:', dataUrl?.length);
        return null;
    }
}

// 上传文件到 Supabase Storage，返回公开 URL；已是 HTTP URL 则跳过
async function _uploadFile(recordId, index, type, dataUrl) {
    const client = _getSupabase();
    if (!client) { console.warn('[Storage] Supabase客户端未初始化，跳过上传'); return null; }
    if (!dataUrl) { console.warn('[Storage] dataUrl为空, 跳过'); return null; }
    if (dataUrl.startsWith('http')) { console.log('[Storage] 已是HTTP URL, 跳过:', dataUrl.substring(0, 60)); return dataUrl; }
    try {
        const file = _dataURLtoFile(dataUrl, `${recordId}_${type}_${index}`);
        if (!file) { console.warn('[Storage] 文件转换失败:', type, index, 'size:', dataUrl.length); return null; }
        const extMap = {'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov'};
        const ext = extMap[file.type] || '';
        const path = `${recordId}/${type}${index}${ext}`;
        console.log(`[Storage] 正在上传: ${path} (${(file.size/1024).toFixed(1)}KB, ${file.type})`);
        const { data: uploadData, error } = await client.storage.from(STORAGE_BUCKET).upload(path, file, { cacheControl:'3600', upsert:true, contentType: file.type });
        if (error) {
            console.error('[Storage] 上传失败:', path, error.message, error.code);
            // 尝试不带contentType再传一次（某些版本SDK兼容问题）
            try {
                const { error: retryError } = await client.storage.from(STORAGE_BUCKET).upload(path, file, { cacheControl:'3600', upsert:true });
                if (retryError) { console.warn('[Storage] 重试也失败:', retryError.message); return null; }
            } catch(retryErr) {
                console.warn('[Storage] 重试异常:', retryErr.message); return null;
            }
        }
        const publicUrl = client.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
        console.log('[Storage] ✓ 上传成功:', publicUrl);
        return publicUrl;
    } catch(e) {
        console.error('[Storage] 上传异常:', e.message, e.stack?.substring(0, 200));
        return null;
    }
}

// 删除记录关联的所有文件
async function _deleteFiles(recordId) {
    const client = _getSupabase();
    if (!client) return;
    try { const {data:list}=await client.storage.from(STORAGE_BUCKET).list(recordId); if(list?.length) await client.storage.from(STORAGE_BUCKET).remove(list.map(f=>`${recordId}/${f.name}`)); } catch(e){}
}

// 本地 IndexedDB 缓存（离线降级）
const _LocalDB = {
    _dbPromise:null,
    _getDB(){if(!this._dbPromise){this._dbPromise=new Promise((res,rej)=>{const r=indexedDB.open('CheckinCache',1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('records'))d.createObjectStore('records',{keyPath:'id'});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}return this._dbPromise;},
    async getAll(){try{const d=await this._getDB();return new Promise((r,j)=>{const s=d.transaction('records','readonly').objectStore('records');const q=s.getAll();q.onsuccess=()=>{r((q.result||[]).map(rec=>{if(rec.userInfo&&typeof rec.userInfo==='string')try{const p=JSON.parse(rec.userInfo);if(typeof p==='object'&&p)rec.userInfo=p;}catch(e){rec.userInfo={};}return rec;}));};q.onerror=()=>j(q.error);});}catch(e){return[];}},
    async put(rec){try{const d=await this._getDB();return new Promise(r=>{const s=d.transaction('records','readwrite').objectStore('records');s.put(rec);s.transaction.oncomplete=()=>r(true);s.transaction.onerror=()=>r(false);});}catch(e){return false;}},
    async del(id){try{const d=await this._getDB();return new Promise(r=>{const s=d.transaction('records','readwrite').objectStore('records');s.delete(id);s.transaction.oncomplete=()=>r(true);s.transaction.onerror=()=>r(false);});}catch(e){return false;}},
    async clear(){try{const d=await this._getDB();return new Promise(r=>{const s=d.transaction('records','readwrite').objectStore('records');s.clear();s.transaction.oncomplete=()=>r(true);s.transaction.onerror=()=>r(false);});}catch(e){return false;}}
};

const Storage = {
    getUserInfo() { try { return JSON.parse(localStorage.getItem('userInfo')); } catch(e) { return null; }},
    saveUserInfo(u) { try { localStorage.setItem('userInfo',JSON.stringify(u)); return true; } catch(e) { return false; }},

    async getCheckinRecords(){
        const c=_getSupabase();
        if(c){
            try{
                // 优化1: 排除 audio_data 大字段(可能数MB/条)，按需懒加载
                // 优化2: 只取必要字段，减少传输量
                const {data,error}=await c.from('records')
                    .select('id,user_info,text,images,videos,has_audio,audio_mime,audio_duration,created_at')
                    .order('created_at',{ascending:false})
                    .limit(200);
                if(!error&&data){
                const recs=data.map(r=>({
                    id:r.id,
                    userInfo:r.user_info||{},
                    text:r.text||'',
                        images:r.images||[],
                        videos:r.videos||[],
                        hasAudio:!!r.has_audio,
                        audioData:null,
                        audioMime:r.audio_mime||'',
                        audioDuration:r.audio_duration||'',
                        createTime:r.created_at,
                        formattedDate:r.created_at?Utils.formatDate(new Date(r.created_at)):''
                }));
                    // 优化3: IndexedDB 批量写入代替串行
                    const db=await _LocalDB._getDB();
                    const tx=db.transaction('records','readwrite');
                    const store=tx.objectStore('records');
                    for(const rec of recs){ store.put(rec); }
                    console.log('[Storage] 从云端加载了'+recs.length+'条(不含音频数据)');
                    return recs;
                }
                console.warn('[Storage] 查询失败:',error?.message);
            }catch(e){console.warn('[Storage] 网络异常:',e.message);}
        }
        return await _LocalDB.getAll();
    },

    // 按需加载单条记录的音频数据(点击播放时调用)
    async loadAudioData(recordId){
        const c=_getSupabase();
        if(!c) return null;
        try{
            const{data,error}=await c.from('records')
                .select('audio_data')
                .eq('id',recordId)
                .single();
            if(!error&&data?.audio_data){
                const buf=this._b64ToArrBuf(data.audio_data);
                // 同步到内存中的 record
                const rec=AppState.records.find(r=>r.id===recordId);
                if(rec){rec.audioData=buf;rec._audioLoaded=true;}
                return buf;
            }
            return null;
        }catch(e){console.warn('[Storage] 音频加载失败:',e.message);return null;}
    },

    async saveCheckinRecord(record){
        const c=_getSupabase();

        // 上传图片 -> 获取公开URL
        let imgUrls=[];
        if(c && record.images && record.images.length>0){
            // 区分需要上传的(base64)和已经是URL的
            const needUpload = record.images.filter(src => src && !src.startsWith('http'));
            if(needUpload.length > 0){
                console.log('[Storage] 上传'+needUpload.length+'张图片...');
                Utils.showToast('正在上传图片...');
                const uploadResults = await Promise.all(
                    record.images.map((src,i) => _uploadFile(record.id, i, 'img', src))
                );
                // 合并结果：成功用新URL，失败但原值是http的保留原值，其他丢弃
                imgUrls=uploadResults.map((url,i)=>{
                    if(url) return url; // 上传成功或原本就是HTTP URL
                    const orig = record.images[i];
                    if(orig && orig.startsWith('http')) return orig;
                    console.warn(`[Storage] 图片${i}上传失败且无法回退`);
                    return null;
                }).filter(Boolean);
                console.log('[Storage] 图片结果:', imgUrls.length+'/'+record.images.length);
            } else {
                imgUrls = [...record.images]; // 全部都是URL了
            }
        }else if(record.images){imgUrls=[...record.images];}

        // 上传视频 -> 获取公开URL
        let vidUrls=[];
        if(c && record.videos && record.videos.length>0){
            const needUploadVid = record.videos.filter(src => src && !src.startsWith('http'));
            if(needUploadVid.length > 0){
                console.log('[Storage] 上传'+needUploadVid.length+'个视频...');
                Utils.showToast('正在上传视频...');
                const vidResults = await Promise.all(
                    record.videos.map((src,i)=>_uploadFile(record.id,i,'vid',src))
                );
                vidUrls=vidResults.map((url,i)=>{
                    if(url) return url;
                    const orig = record.videos[i];
                    if(orig && orig.startsWith('http')) return orig;
                    console.warn(`[Storage] 视频${i}上传失败且无法回退`);
                    return null;
                }).filter(Boolean);
                console.log('[Storage] 视频结果:', vidUrls.length+'/'+record.videos.length);
            } else {
                vidUrls = [...record.videos];
            }
        }else if(record.videos){vidUrls=[...record.videos];}

        const row={id:record.id,user_info:record.userInfo,text:record.text||'',
            images:imgUrls,videos:vidUrls,
            has_audio:!!record.hasAudio,audio_data:record.audioData?this._arrBufToB64(record.audioData):null,
            audio_mime:record.audioMime||'',audio_duration:record.audioDuration||'',
            created_at:record.createTime||new Date().toISOString()};
        let ok=false;
        if(c){
            try{const{error}=await c.from('records').upsert(row);if(!error){ok=true;console.log('[Storage] ✓ 已同步云端');}else console.warn('[Storage] 保存失败:',error.message);}catch(e){console.warn('[Storage] 网络异常',e.message);}
        }
        const lok=await _LocalDB.put(Object.assign({},record));
        if(!ok&&!lok){Utils.showToast('保存失败');return null;}
        if(!ok) Utils.showToast('已保存(离线)');
        return record;
    },

    async deleteCheckinRecord(id){await _deleteFiles(id);const c=_getSupabase();if(c)try{await c.from('records').delete().eq('id',id);}catch(e){}return await _LocalDB.del(id);},

    async clearAll(){localStorage.removeItem('userInfo');const c=_getSupabase();if(c)try{await c.from('records').delete().neq('id','___never_match___');}catch(e){}return await _LocalDB.clear();},

    _arrBufToB64(buf){const b=new Uint8Array(buf),s=[];for(let i=0;i<b.length;i++)s.push(String.fromCharCode(b[i]));return btoa(s.join(''));},
    _b64ToArrBuf(b64){try{const b=atob(b64),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer;}catch(e){return null;}}
};

// ==================== 全局状态 ====================
const AppState = {
    currentPage: 'home', userInfo: null, records: [],
    mediaRecorder: null, audioChunks: [], recordingTimer: null,
    recordingTime: 0, audioPlayer: null
};
let checkinData = { text: '', images: [], videos: [], audioBlob: null, audioUrl: null, audioMime: '', audioDuration: 0 };
let editingRecordId = null;

// ==================== 初始化 ====================
async function startApp() {
    initApp(); initTabBar(); loadUserInfo();
    // 优化: 优先显示本地缓存(秒开)，后台静默刷新云端
    const localRecords = await _LocalDB.getAll();
    if(localRecords.length > 0){
        AppState.records = localRecords;
        renderPage('home');
        // 后台静拉取最新数据
        _silentRefresh();
    } else {
        // 无本地缓存，等待云端
        await loadRecords();
        renderPage('home');
    }
}
// 后台静默刷新（不阻塞UI）
async function _silentRefresh(){
    const c=_getSupabase();
    if(!c) return;
    try{
        const {data,error}=await c.from('records')
            .select('id,user_info,text,images,videos,has_audio,audio_mime,audio_duration,created_at')
            .order('created_at',{ascending:false})
            .limit(200);
        if(!error&&data&&data.length>0){
            const recs=data.map(r=>({id:r.id,userInfo:r.user_info||{},text:r.text||'',images:r.images||[],videos:r.videos||[],
                hasAudio:!!r.has_audio,audioData:null,
                audioMime:r.audio_mime||'',audioDuration:r.audio_duration||'',
                createTime:r.created_at,formattedDate:r.created_at?Utils.formatDate(new Date(r.created_at)):''
            }));
            AppState.records=recs;
            const db=await _LocalDB._getDB();
            db.transaction('records','readwrite').objectStore('records').clear();
            const tx=db.transaction('records','readwrite');
            for(const rec of recs){tx.objectStore('records').put(rec);}
            console.log('[Storage] 后台刷新完成:'+recs.length+'条');
            // 如果当前页面是首页或历史，静默更新显示
            if(AppState.currentPage==='home'||AppState.currentPage==='history') renderPage(AppState.currentPage);
        }
    }catch(e){console.warn('[Storage] 后台刷新失败:',e.message);}
}
function initApp() { if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) console.warn('当前浏览器不支持录音功能'); }
function loadUserInfo() { AppState.userInfo = Storage.getUserInfo(); }
async function loadRecords() { AppState.records = await Storage.getCheckinRecords(); }

function initTabBar() {
    const tabItems = document.querySelectorAll('.tab-item');
    tabItems.forEach(item => item.addEventListener('click', () => {
        const page = item.dataset.page; if (page === AppState.currentPage) return;
        tabItems.forEach(t => t.classList.remove('active')); item.classList.add('active'); renderPage(page);
    }));
}

function renderPage(page) {
    AppState.currentPage = page; const app = document.getElementById('app');
    switch(page) {
        case 'home': app.innerHTML = renderHomePage(); initHomePage(); break;
        case 'checkin': app.innerHTML = renderCheckinPage(); initCheckinPage(); break;
        case 'history': app.innerHTML = renderHistoryPage(); initHistoryPage(); break;
        case 'profile': app.innerHTML = renderProfilePage(); initProfilePage(); break;
    }
    window.scrollTo(0, 0);
}
function navigateToPage(page) { document.querySelectorAll('.tab-item').forEach(item => item.classList.toggle('active', item.dataset.page === page)); renderPage(page); }

// ==================== 首页 ====================
function renderHomePage(){
    const u=AppState.userInfo,r=AppState.records,today=new Date().toDateString(),todayCount=r.filter(r=>new Date(r.createTime).toDateString()===today).length,recent=r.slice(0,3),total=r.length,streak=Utils.calculateStreak(r);
    return `<div class="page active" id="homePage"><div class="container"><div class="user-card" onclick="navigateToPage('profile')"><div class="user-avatar">${u?.name?u.name[0]:'?'}</div><div class="user-info"><span class="user-name">${u?.name||'未设置昵称'}</span>${u?.gender?`<div class="user-meta"><span class="tag">${u.gender==='male'?'男':'女'}</span>${u.age?`<span class="tag">${u.age}岁</span>`:''}</div>`:'<span class="user-tip">点击完善个人信息</span>'}</div><span class="arrow">></span></div>
        <div class="stats-card"><div class="stat-item"><span class="stat-num">${total}</span><span class="stat-label">总打卡</span></div><div class="stat-divider"></div><div class="stat-item"><span class="stat-num">${streak}</span><span class="stat-label">连续打卡</span></div><div class="stat-divider"></div><div class="stat-item"><span class="stat-num">${todayCount}次</span><span class="stat-label">今日打卡</span></div></div>
        <div class="checkin-action"><button class="checkin-btn" id="homeCheckinBtn"><span class="checkin-icon">+</span><span class="checkin-text">立即打卡</span></button></div>
        <div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><span style="font-size:18px;font-weight:600;">最近记录</span><span style="font-size:14px;color:var(--primary);cursor:pointer;" onclick="navigateToPage('history')">查看全部 ></span></div>
        ${recent.length>0?recent.map(renderRecordItem).join(''):`<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-text">还没有打卡记录，快去打卡吧~</div></div>`}
        </div></div></div>`;
}

function renderRecordItem(rec){
    return `<div class="record-item" onclick="navigateToDetail('${rec.id}')"><div class="record-header"><div class="record-user"><div class="record-avatar">${rec.userInfo?.name?.[0]||'?'}</div><div class="record-meta"><span class="record-name">${rec.userInfo?.name||'未知用户'}</span><span class="record-date">${rec.formattedDate}</span></div></div></div>
        ${rec.text?`<div class="record-content">${rec.text}</div>`:''}
        ${(rec.images?.length>0||rec.videos?.length>0)?`<div class="record-media">${rec.images?.map(i=>`<div class="record-media-item"><img src="${i}" alt="打卡图片" loading="lazy"/></div>`).join('')||''}${rec.videos?.map(v=>`<div class="record-media-item"><video src="${v}" preload="metadata"></video></div>`).join('')||''}</div>`:''}
        ${rec.hasAudio?`<div class="audio-player" onclick="playHistoryAudio('${rec.id}',this)"><div class="audio-icon"><span>♪</span></div><div class="audio-info"><span class="audio-duration">${rec.audioDuration||'语音'} ></span></div></div>`:''}
        <div class="record-types">${rec.text?'<span class="type-tag">文字</span>':''}${rec.images?.length>0?'<span class="type-tag">图片</span>':''}${rec.videos?.length>0?'<span class="type-tag">视频</span>':''}${rec.hasAudio?'<span class="type-tag">语音</span>':''}</div></div>`;
}

function initHomePage(){
    const btn=document.getElementById('homeCheckinBtn');
    if(btn)btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();goToCheckin();});
}
function goToCheckin(){
    if(!AppState.userInfo||!AppState.userInfo.name){Utils.showConfirm('提示','请先完善个人信息',()=>navigateToPage('profile'),null,'去设置','取消');return;}
    editingRecordId=null;
    navigateToPage('checkin');
}

// ==================== 详情页 ====================
function navigateToDetail(id){
    const rec=AppState.records.find(r=>r.id===id);if(!rec){Utils.showToast('记录不存在');return;}
    document.getElementById('app').innerHTML=renderDetailPage(rec);document.getElementById('tabBar').style.display='none';
}
function renderDetailPage(rec){return`<div class="page active detail-page"><div class="container"><div style="margin-bottom:16px;"><button class="btn btn-default" onclick="goBack()" style="width:auto;padding:8px 16px;">← 返回</button></div><div class="user-card"><div class="user-avatar">${rec.userInfo?.name?.[0]||'?'}</div><div class="user-info"><span class="user-name">${rec.userInfo?.name||'未知用户'}</span><div class="user-meta"><span class="tag">${rec.userInfo?.gender==='male'?'男':'女'}</span><span class="tag">${rec.userInfo?.age}岁</span></div></div></div><div class="time-bar"><span class="time-icon">🕐</span><span class="time-text">${rec.formattedDate}</span></div>${rec.text?`<div class="card"><div class="card-title">好句分享</div><div class="detail-text">${rec.text}</div></div>`:''}${rec.images?.length>0?`<div class="card"><div class="card-title">图片(${rec.images.length}张)</div><div class="detail-media-grid">${rec.images.map(i=>`<div class="detail-media-item"><img src="${i}" loading="lazy"/></div>`).join('')}</div></div>`:''}${rec.videos?.length>0?`<div class="card"><div class="card-title">视频(${rec.videos.length}个)</div><div class="detail-video-list">${rec.videos.map(v=>`<div class="detail-video-item"><video src="${v}" controls preload="metadata"></video></div>`).join('')}</div></div>`:''}${rec.hasAudio?`<div class="card"><div class="card-title">语音记录</div><div class="detail-audio-player"><div class="play-btn" id="detailPlayBtn" onclick="event.stopPropagation();playDetailAudio('${rec.id}')"><span>▶</span></div><div class="audio-info"><span class="audio-title">语音记录</span><span class="audio-duration">${rec.audioDuration||''}</span><div class="audio-progress" id="detailProgress"><span class="audio-progress-time" id="detailCurTime">0:00</span><div class="audio-progress-bar" onclick="event.stopPropagation();seekDetailAudio(event)"><div class="audio-progress-fill" id="detailProgressFill"></div></div><span class="audio-progress-time" id="detailDurTime">${rec.audioDuration||'0:00'}</span></div></div></div></div>`:''}<div class="card"><div class="card-title">记录类型</div><div class="detail-types">${rec.text?'<span class="detail-type-tag">📝 文字</span>':''}${rec.images?.length>0?'<span class="detail-type-tag">📷 图片</span>':''}${rec.videos?.length>0?'<span class="detail-type-tag">🎬 视频</span>':''}${rec.hasAudio?'<span class="detail-type-tag">🎤 语音</span>':''}</div></div><div style="margin-top:24px;margin-bottom:40px;display:flex;gap:12px;"><button class="btn btn-primary" onclick="editDetailRecord('${rec.id}')">编辑记录</button><button class="btn btn-danger" onclick="deleteDetailRecord('${rec.id}')">删除记录</button></div></div></div>`;}
async function playDetailAudio(id){
    const rec=AppState.records.find(r=>r.id===id);if(!rec){Utils.showToast('记录不存在');return;}
    const b=document.getElementById('detailPlayBtn');if(!b)return;
    // 如果当前详情页正在播放本条音频，则暂停
    if(AppState.audioPlayer&&AppState._playingId===id&&AppState._playingLoc==='detail'){
        AppState.audioPlayer.pause();AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;b.classList.remove('playing');b.innerHTML='<span>▶</span>';return;
    }
    // 立即显示加载态
    b.innerHTML='<span>⏳</span>';
    // 停止其他地方的音频
    if(AppState.audioPlayer){AppState.audioPlayer.pause();AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;}
    // 懒加载：audioData 为空时从云端获取
    if(!rec.audioData){
        Utils.showToast('加载音频中...');
        try{
            rec.audioData=await Storage.loadAudioData(id);
            if(!rec.audioData){Utils.showToast('音频数据不可用');b.classList.remove('playing');b.innerHTML='<span>▶</span>';return;}
        }catch(e){Utils.showToast('音频加载失败');b.classList.remove('playing');b.innerHTML='<span>▶</span>';return;}
    }
    try{
        const blob=new Blob([rec.audioData],{type:rec.audioMime||'audio/webm'}),url=URL.createObjectURL(blob),a=new Audio(url);
        a.preload='auto';
        // 先设置播放中状态（不等 play() resolve）
        const btn=document.getElementById('detailPlayBtn');if(btn){btn.classList.add('playing');btn.innerHTML='<span>⏸</span>';}
        AppState.audioPlayer=a;AppState._playingId=id;AppState._playingLoc='detail';
        const _fmt=t=>{const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+String(s).padStart(2,'0');};
        a.addEventListener('timeupdate',()=>{
            const cur=document.getElementById('detailCurTime'),dur=document.getElementById('detailDurTime'),fill=document.getElementById('detailProgressFill');
            if(cur)cur.textContent=_fmt(a.currentTime);if(dur)dur.textContent=_fmt(a.duration||0);if(fill){fill.style.width=(a.duration>0?a.currentTime/a.duration*100:0)+'%';}
        });
        a.play().then(()=>{}).catch(err=>{
            console.error('[ERROR] 详情页播放失败:',err);
            const btn2=document.getElementById('detailPlayBtn');
            if(btn2){btn2.classList.remove('playing');btn2.innerHTML='<span>▶</span>';}
            Utils.showToast('播放失败，请重试');
            URL.revokeObjectURL(url);
            if(AppState.audioPlayer===a){AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;}
        });
        a.onended=()=>{URL.revokeObjectURL(url);const btn3=document.getElementById('detailPlayBtn');if(btn3){btn3.classList.remove('playing');btn3.innerHTML='<span>▶</span>';}AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;};
        a.onerror=()=>{Utils.showToast('语音播放失败');URL.revokeObjectURL(url);const btn4=document.getElementById('detailPlayBtn');if(btn4){btn4.classList.remove('playing');btn4.innerHTML='<span>▶</span>';}AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;};
    }catch(e){console.error('[ERROR] 播放异常:',e);Utils.showToast('音频加载失败');const btn5=document.getElementById('detailPlayBtn');if(btn5){btn5.classList.remove('playing');btn5.innerHTML='<span>▶</span>';}}
}
async function deleteDetailRecord(id){Utils.showConfirm('确认删除','确定要删除这条打卡记录吗？',async()=>{await Storage.deleteCheckinRecord(id);await loadRecords();goBack();Utils.showToast('已删除');},null,'删除','取消',true);}
function editDetailRecord(id){editingRecordId=id;goBack();setTimeout(()=>navigateToPage('checkin'),100);}
function goBack(){document.getElementById('tabBar').style.display='flex';renderPage('history');document.querySelectorAll('.tab-item').forEach(i=>i.classList.toggle('active',i.dataset.page==='history'));}

// ==================== 打卡页 ====================
function renderCheckinPage(){
    const isEdit=editingRecordId!==null,title=isEdit?'编辑打卡':'今日打卡';
    return `<div class="page active" id="checkinPage"><div class="container">
        <div class="checkin-page-header"><span class="checkin-page-title">${title}</span>${isEdit?'<span class="edit-badge">编辑模式</span>':''}</div>
        <div class="user-tip-bar" id="checkinUserTip">请先完善个人信息</div>
        <div class="card"><div class="card-title">好句分享</div><textarea class="form-textarea" id="checkinText" placeholder="记录今天的心情、想法或见闻..." maxlength="500"></textarea></div>
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><div class="card-title">图片</div><span style="font-size:14px;color:var(--text-light);" id="imageCount">0/9</span></div><div class="media-grid" id="imageGrid"><div class="media-item add-media" onclick="chooseImage()"><span class="add-icon">+</span><span class="add-label">添加图片</span></div></div></div>
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><div class="card-title">视频</div><span style="font-size:14px;color:var(--text-light);" id="videoCount">0/3</span></div><div class="media-grid" id="videoGrid"><div class="media-item add-media" onclick="chooseVideo()"><span class="add-icon">+</span><span class="add-label">添加视频</span></div></div></div>
        <div class="card"><div class="card-title">语音记录</div><div id="audioSection"><div class="record-btn" onclick="startRecord()"><div style="font-size:48px;margin-bottom:8px;">🎤</div><div style="font-size:15px;color:var(--text-secondary);">点击开始录音</div></div></div></div>
        <div style="margin-top:24px;margin-bottom:40px;"><button class="btn btn-primary" id="submitBtn">${isEdit?'保存修改':'提交打卡'}</button></div>
        </div></div><input type="file" id="imageInput" accept="image/*" multiple onchange="handleImageSelect(event)"><input type="file" id="videoInput" accept="video/*" onchange="handleVideoSelect(event)">`;
}

function initCheckinPage(){
    const u=AppState.userInfo,tip=document.getElementById('checkinUserTip');
    if(u&&u.name)tip.textContent=`${u.name} · ${u.gender==='male'?'男':'女'} · ${u.age}岁`;
    else tip.innerHTML='请先<a href="#" onclick="navigateToPage(\'profile\')" style="color:var(--primary)">完善个人信息</a>';
    // 重置状态锁
    isSubmitting=false;isUploading=false;
    if(editingRecordId){
        const rec=AppState.records.find(r=>r.id===editingRecordId);
        if(rec){
            let au=null;
            if(rec.audioData){try{au=URL.createObjectURL(new Blob([rec.audioData],{type:rec.audioMime||'audio/webm'}));}catch(e){}}
            checkinData={text:rec.text||'',images:[...(rec.images||[])],videos:[...(rec.videos||[])],audioBlob:null,audioUrl:au,audioDuration:Utils.parseDuration(rec.audioDuration),_hasAudio:!!rec.hasAudio,_audioMime:rec.audioMime||''};
            const ta=document.getElementById('checkinText');if(ta)ta.value=checkinData.text;
        }else editingRecordId=null;
    }else checkinData={text:'',images:[],videos:[],audioBlob:null,audioUrl:null,audioDuration:0,_hasAudio:false,_audioMime:''};
    // 防止事件监听器重复绑定（使用 dataset 标志位）
    const ta2=document.getElementById('checkinText');
    if(ta2&&!ta2.dataset.bound){ta2.addEventListener('input',e=>{checkinData.text=e.target.value;updateSubmitButton();});ta2.dataset.bound='1';}
    const sb=document.getElementById('submitBtn');
    if(sb&&!sb.dataset.bound){sb.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();submitCheckin();});sb.dataset.bound='1';}
    updateImageGrid();updateVideoGrid();updateAudioSection();updateSubmitButton();
}

// 更新提交按钮状态（仅在上传/提交期间禁用，默认可点击）
function updateSubmitButton(){
    const b=document.getElementById('submitBtn');
    if(!b)return;
    // 仅在上传中或提交中时禁用
    if(isUploading||isSubmitting){lockSubmitBtn(true);return;}
    // 默认启用，校验交给点击时处理
    b.disabled=false;b.textContent='提交打卡';b.style.opacity='1';b.style.pointerEvents='auto';b.style.cursor='';
}

// 选择图片（含上传锁拦截）
function chooseImage(){
    if(isUploading){Utils.showToast('正在上传图片，请稍候');return;}
    if(checkinData.images.length>=9){Utils.showToast('最多9张图片');return;}
    document.getElementById('imageInput').click();
}

// 处理图片选择（含上传进度反馈 + 错误处理）
function handleImageSelect(e){
    if(isUploading)return;
    const files=Array.from(e.target.files),rem=9-checkinData.images.length;
    // 限制单张图片最大10MB
    const MAX_IMG_SIZE=10*1024*1024;
    const validFiles=files.filter(f=>f.size<=MAX_IMG_SIZE);
    if(validFiles.length===0){Utils.showToast('图片太大，请选择10MB以内的图片');e.target.value='';return;}
    const sel=validFiles.slice(0,rem);
    if(sel.length===0){e.target.value='';return;}
    isUploading=true;lockSubmitBtn(true,'上传图片中...');
    let completed=0;
    sel.forEach(f=>{
        const r=new FileReader();
        r.onload=e2=>{checkinData.images.push(e2.target.result);completed++;updateImageGrid();if(completed===sel.length){isUploading=false;updateSubmitButton();}};
        r.onerror=()=>{completed++;if(completed===sel.length){isUploading=false;updateSubmitButton();Utils.showToast('图片读取失败');}};
        r.readAsDataURL(f);
    });
    const skipped=files.length-validFiles.length;
    if(skipped>0)Utils.showToast(`${skipped}张图片过大已跳过(限10MB)`);
    else if(files.length>rem)Utils.showToast(`只添加了${rem}张图片`);
    e.target.value='';
}
function updateImageGrid(){
    const g=document.getElementById('imageGrid'),c=document.getElementById('imageCount');c.textContent=checkinData.images.length+'/9';
    const ws='position:relative;width:100%;min-width:80px;min-height:80px;overflow:visible;';
    let h=checkinData.images.map((i,idx)=>`<div data-iidx="${idx}" style="${ws}"><img src="${i}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:8px;pointer-events:none;"/></div>`).join('');
    if(checkinData.images.length<9)h+=`<div class="media-item add-media" onclick="chooseImage()"><span class="add-icon">+</span><span class="add-label">添加图片</span></div>`;
    g.innerHTML=h;
    g.querySelectorAll(':scope > div[data-iidx]').forEach(item=>{
        const idx=item.getAttribute('data-iidx'),btn=document.createElement('button');
        btn.innerHTML='&#215;';btn.onclick=(e)=>{e.stopPropagation();deleteImage(Number(idx));};
        Object.assign(btn.style,{position:'absolute',top:'4px',right:'4px',width:'26px',height:'26px',background:'#ff4d4f',color:'#fff',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px',fontWeight:'bold',cursor:'pointer',zIndex:'9999',border:'2px solid #fff',boxShadow:'0 2px 6px rgba(0,0,0,0.5)',padding:'0',lineHeight:'1'});
        item.appendChild(btn);
    });
}
function deleteImage(idx){checkinData.images.splice(idx,1);updateImageGrid();updateSubmitButton();}
// 选择视频（含上传锁拦截）
function chooseVideo(){
    if(isUploading){Utils.showToast('正在上传视频，请稍候');return;}
    if(checkinData.videos.length>=3){Utils.showToast('最多3个视频');return;}
    document.getElementById('videoInput').click();
}

// 处理视频选择（含大小限制 + 错误处理）
function handleVideoSelect(e){
    if(isUploading)return;
    const f=e.target.files[0];
    if(!f)return;
    // 限制单个视频最大50MB
    const MAX_VIDEO_SIZE=50*1024*1024;
    if(f.size>MAX_VIDEO_SIZE){
        Utils.showToast('视频太大，请选择50MB以内的视频');e.target.value='';return;
    }
    isUploading=true;lockSubmitBtn(true,'上传视频中...');
    const r=new FileReader();
    r.onload=e2=>{checkinData.videos.push(e2.target.result);updateVideoGrid();isUploading=false;updateSubmitButton();};
    r.onerror=()=>{isUploading=false;updateSubmitButton();Utils.showToast('视频读取失败，可能文件过大');};
    r.onabort=()=>{isUploading=false;updateSubmitButton();Utils.showToast('视频读取已取消');};
    r.readAsDataURL(f);
    e.target.value='';
}
function updateVideoGrid(){
    const g=document.getElementById('videoGrid'),c=document.getElementById('videoCount');c.textContent=`${checkinData.videos.length}/3`;
    const ws='position:relative;width:100%;min-width:80px;min-height:80px;overflow:visible;';
    let h=checkinData.videos.map((v,idx)=>`<div data-vidx="${idx}" style="${ws}"><video src="${v}" preload="metadata" style="width:100%;height:100%;object-fit:cover;pointer-events:none;display:block;border-radius:8px;"/></div>`).join('');
    if(checkinData.videos.length<3)h+=`<div class="media-item add-media" onclick="chooseVideo()"><span class="add-icon">+</span><span class="add-label">添加视频</span></div>`;
    g.innerHTML=h;
    g.querySelectorAll(':scope > div[data-vidx]').forEach(item=>{
        const idx=item.getAttribute('data-vidx'),btn=document.createElement('button');
        btn.innerHTML='&#215;';btn.onclick=(e)=>{e.stopPropagation();deleteVideo(Number(idx));};
        Object.assign(btn.style,{position:'absolute',top:'4px',right:'4px',width:'26px',height:'26px',background:'#ff4d4f',color:'#fff',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px',fontWeight:'bold',cursor:'pointer',zIndex:'9999',border:'2px solid #fff',boxShadow:'0 2px 6px rgba(0,0,0,0.5)',padding:'0',lineHeight:'1'});
        item.appendChild(btn);
    });
}
function deleteVideo(idx){checkinData.videos.splice(idx,1);updateVideoGrid();updateSubmitButton();}
async function startRecord(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){Utils.showToast('当前浏览器不支持录音');return;}
    try{
        const s=await navigator.mediaDevices.getUserMedia({audio:true}),mimeTypes=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/wav'];
        let mimeType='';
        if(MediaRecorder.isTypeSupported){for(const t of mimeTypes){if(MediaRecorder.isTypeSupported(t)){mimeType=t;break;}}}
        const mr=new MediaRecorder(s,mimeType?{mimeType}:{}),ac=[];
        mr.ondataavailable=e=>{if(e.data.size>0)ac.push(e.data);};
        mr.onstop=()=>{
            const actualMime=mr.mimeType||'audio/webm',ab=new Blob(ac,{type:actualMime}),au=URL.createObjectURL(ab);
            checkinData.audioBlob=ab;checkinData.audioUrl=au;checkinData.audioMime=actualMime;
            updateAudioSection();updateSubmitButton();s.getTracks().forEach(t=>t.stop());
        };
        AppState.mediaRecorder=mr;AppState.mediaChunks=ac;mr.start();showRecordingUI();
    }catch(err){console.error('录音失败:',err);Utils.showToast('无法访问麦克风，请检查权限');}
}
function showRecordingUI(){const sec=document.getElementById('audioSection');AppState.recordingTime=0;sec.innerHTML=`<div class="recording-panel"><div class="recording-wave"><div class="wave-dot"></div><div class="wave-dot"></div><div class="wave-dot"></div></div><div class="recording-time" id="recordingTime">00s</div><div class="recording-tip">录音中，点击停止</div><button class="stop-record-btn" onclick="stopRecord()">停止录音</button></div>`;AppState.recordingTimer=setInterval(()=>{AppState.recordingTime++;const te=document.getElementById('recordingTime');if(te)te.textContent=`${String(AppState.recordingTime).padStart(2,'0')}s`;if(AppState.recordingTime>=600)stopRecord();},1000);}
function stopRecord(){if(AppState.recordingTimer){clearInterval(AppState.recordingTimer);AppState.recordingTimer=null;}if(AppState.mediaRecorder&&AppState.mediaRecorder.state!=='inactive'){checkinData.audioDuration=AppState.recordingTime;AppState.mediaRecorder.stop();}}
function updateAudioSection(){
    const s=document.getElementById('audioSection'),hasAudio=checkinData.audioBlob||(checkinData.audioUrl&&editingRecordId)||(editingRecordId&&checkinData._hasAudio);
    if(hasAudio){
        let duration=Utils.formatDuration(checkinData.audioDuration)||'语音';
        s.innerHTML=`<div class="audio-player"><div class="audio-icon" onclick="playCheckinAudio()" id="checkinPlayBtn"><span>▶</span></div><div class="audio-info"><span class="audio-title">语音记录</span><span class="audio-duration">${duration}</span><div class="audio-progress" id="checkinProgress"><span class="audio-progress-time" id="checkinCurTime">0:00</span><div class="audio-progress-bar" onclick="seekCheckinAudio(event)"><div class="audio-progress-fill" id="checkinProgressFill"></div><div class="audio-progress-dot" id="checkinProgressDot"></div></div><span class="audio-progress-time" id="checkinDurTime">0:00</span></div></div><div class="audio-delete" onclick="deleteAudio()">删除重录</div></div>`;
    }else s.innerHTML=`<div class="record-btn" onclick="startRecord()"><div style="font-size:48px;margin-bottom:8px;">🎤</div><div style="font-size:15px;color:var(--text-secondary);">点击开始录音</div></div>`;
}
async function playCheckinAudio(){
    const pb=document.getElementById('checkinPlayBtn');if(!pb)return;
    if(AppState.audioPlayer&&AppState._playingId==='_checkin'&&AppState._playingLoc==='checkin'){
        AppState.audioPlayer.pause();AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;pb.innerHTML='<span>▶</span>';return;
    }
    // 立即显示加载态
    pb.innerHTML='<span>⏳</span>';
    if(AppState.audioPlayer){AppState.audioPlayer.pause();AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;}
    let url=checkinData.audioUrl;
    if(!url){
        let data=null;
        if(checkinData.audioBlob)data=checkinData.audioBlob;
        else if(editingRecordId){const rec=AppState.records.find(r=>r.id===editingRecordId);if(rec&&rec.audioData)data=rec.audioData;}
        if(!data){
            // 编辑模式下懒加载音频
            if(editingRecordId){
                pb.innerHTML='<span>⏳</span>';Utils.showToast('加载音频中...');
                try{const loaded=await Storage.loadAudioData(editingRecordId);if(loaded){data=loaded;const rec=AppState.records.find(r=>r.id===editingRecordId);if(rec)rec.audioData=loaded;}else{Utils.showToast('音频数据不可用');pb.innerHTML='<span>▶</span>';return;}}catch(e){Utils.showToast('音频加载失败');pb.innerHTML='<span>▶</span>';return;}
            }else{Utils.showToast('没有音频数据');return;}
        }
        try{const mime=editingRecordId?(AppState.records.find(r=>r.id===editingRecordId)?.audioMime||checkinData._audioMime):'audio/webm';url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type:mime||'audio/webm'}));checkinData.audioUrl=url;}catch(e){Utils.showToast('音频加载失败');return;}
    }
    const a=new Audio(url);a.preload='auto';a.crossOrigin='anonymous';
    // 先设置播放中状态
    const btn=document.getElementById('checkinPlayBtn');if(btn){btn.innerHTML='<span>⏸</span>';}
    AppState.audioPlayer=a;AppState._playingId='_checkin';AppState._playingLoc='checkin';
    const _fmt=t=>{const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+String(s).padStart(2,'0');};
    a.addEventListener('timeupdate',()=>{
        const cur=document.getElementById('checkinCurTime'),dur=document.getElementById('checkinDurTime'),fill=document.getElementById('checkinProgressFill'),dot=document.getElementById('checkinProgressDot');
        if(cur)cur.textContent=_fmt(a.currentTime);if(dur)dur.textContent=_fmt(a.duration||0);if(fill){const pct=(a.duration>0?a.currentTime/a.duration*100:0)+'%';fill.style.width=pct;if(dot)dot.style.left=pct;}
    });
    a.play().then(()=>{}).catch(err=>{Utils.showToast('播放失败，请重试');const b2=document.getElementById('checkinPlayBtn');if(b2)b2.innerHTML='<span>▶</span>';if(AppState.audioPlayer===a){AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;}});
    a.onended=()=>{const b3=document.getElementById('checkinPlayBtn');if(b3)b3.innerHTML='<span>▶</span>';AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;};
    a.onerror=()=>{Utils.showToast('语音播放失败');const b4=document.getElementById('checkinPlayBtn');if(b4)b4.innerHTML='<span>▶</span>';AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;};
}
function seekCheckinAudio(e){
    if(!AppState.audioPlayer)return;
    e.stopPropagation();
    const bar=e.currentTarget,rect=bar.getBoundingClientRect(),pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    AppState.audioPlayer.currentTime=pct*AppState.audioPlayer.duration;
}
function seekDetailAudio(e){
    if(!AppState.audioPlayer)return;
    e.stopPropagation();
    const bar=e.currentTarget,rect=bar.getBoundingClientRect(),pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    AppState.audioPlayer.currentTime=pct*AppState.audioPlayer.duration;
}
function deleteAudio(){checkinData.audioBlob=null;checkinData.audioUrl=null;checkinData.audioMime='';checkinData.audioDuration=0;if(AppState.audioPlayer){AppState.audioPlayer.pause();AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;}updateAudioSection();updateSubmitButton();}
// 提交锁定状态
let isSubmitting=false;

function lockSubmitBtn(locked){
    const btn=document.getElementById('submitBtn');
    if(!btn)return;
    if(locked){
        btn.disabled=true;btn.textContent='提交中...';btn.style.opacity='0.5';btn.style.pointerEvents='none';
    }else{
        btn.disabled=false;btn.textContent='提交打卡';btn.style.opacity='';btn.style.pointerEvents='';
    }
}

async function submitCheckin(){
    // 第1步：校验（不通过直接返回，不锁按钮）
    if(isSubmitting)return;
    if(isUploading){Utils.showToast('正在上传文件，请稍候');return;}

    // 校验好句分享不能为空（从 DOM 取最新值）
    const textEl=document.getElementById('checkinText');
    const rawText=textEl?textEl.value:'';
    const textValue=rawText?rawText.trim():'';
    checkinData.text=rawText;

    if(!textValue){
        Utils.showConfirm('提示','好句分享不能为空，请填写内容后再提交',()=>{
            if(textEl)textEl.focus();
        },null,'去填写','取消',false);
        return;
    }

    // 第2步：校验通过 → 立即置灰锁定
    isSubmitting=true;
    lockSubmitBtn(true);

    // 第3步：执行保存
    try {
        const u=AppState.userInfo||{name:'匿名用户',gender:'',age:null};
        let audioData=null;
        if(checkinData.audioBlob)audioData=await checkinData.audioBlob.arrayBuffer();
        else if(editingRecordId){const old=AppState.records.find(r=>r.id===editingRecordId);if(old){
            if(old.audioData)audioData=old.audioData;
            else if(checkinData._hasAudio){try{audioData=await Storage.loadAudioData(editingRecordId);}catch(e){}}
        }}
        const rec={
            id:editingRecordId||Utils.generateId(),
            userInfo:{name:u.name||'匿名用户',gender:u.gender||'',age:u.age||null},
            text:textValue,
            images:[...checkinData.images],videos:[...checkinData.videos],
            hasAudio:!!checkinData.audioBlob||!!audioData||(editingRecordId&&checkinData._hasAudio),
            audioData:audioData,
            audioMime:checkinData.audioMime||(editingRecordId?(AppState.records.find(r=>r.id===editingRecordId)?.audioMime||checkinData._audioMime):'audio/webm'),
            audioDuration:checkinData.audioDuration?Utils.formatDuration(checkinData.audioDuration):(editingRecordId?(AppState.records.find(r=>r.id===editingRecordId)?.audioDuration||''):''),
            createTime:editingRecordId?(AppState.records.find(r=>r.id===editingRecordId)?.createTime||new Date().toISOString()):new Date().toISOString(),
            formattedDate:Utils.formatDate(new Date())
        };
        const saved=await Storage.saveCheckinRecord(rec);
        if(!saved){
            isSubmitting=false;lockSubmitBtn(false);
            Utils.showToast('保存失败，请重试');return;
        }
        await loadRecords();
        Utils.showToast(editingRecordId?'更新成功！':'打卡成功！');
        editingRecordId=null;

        // ========== 第4步：结束恢复 ==========
        setTimeout(()=>{isSubmitting=false;lockSubmitBtn(false);navigateToPage('home');},1500);
    }catch(err){
        isSubmitting=false;lockSubmitBtn(false);
        console.error('[ERROR] 打卡失败:',err);
        const msg=err.name==='QuotaExceededError'||String(err).includes('quota')||String(err).includes('存储')?'文件过大，存储空间不足，请减小视频/图片后重试':'打卡失败，请重试';
        Utils.showToast(msg);
    }
}

// ==================== 历史记录页 ====================
function renderHistoryPage(){return`<div class="page active" id="historyPage"><div class="container"><div class="filter-bar"><select class="filter-select" id="filterType" onchange="filterRecords()"><option value="all">全部</option><option value="text">文字</option><option value="image">图片</option><option value="video">视频</option><option value="audio">语音</option></select><span class="record-count" id="recordCount">共 ${AppState.records.length} 条记录</span></div><div id="historyList">${renderHistoryList(AppState.records)}</div></div></div>`;}
function renderHistoryList(records){if(records.length===0)return`<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">还没有打卡记录</div><button class="btn btn-primary" style="margin-top:20px;width:auto;padding:12px 40px;" onclick="navigateToPage('checkin')">去打卡</button></div>`;return records.map(r=>`<div class="record-item"><div class="record-header"><div class="record-user"><div class="record-avatar">${r.userInfo?.name?.[0]||'?'}</div><div class="record-meta"><span class="record-name">${r.userInfo?.name||'未知用户'}</span><span class="record-date">${r.formattedDate}</span></div></div><div class="record-actions"><button class="action-btn view" onclick="navigateToDetail('${r.id}')">查看</button><button class="action-btn edit" onclick="editHistoryRecord('${r.id}')">编辑</button><button class="action-btn delete" onclick="deleteHistoryRecord('${r.id}')">删除</button></div></div>${r.text?`<div class="record-content">${r.text}</div>`:''}${(r.images?.length>0||r.videos?.length>0)?`<div class="record-media">${r.images?.map(i=>`<div class="record-media-item"><img src="${i}" loading="lazy"/></div>`).join('')||''}${r.videos?.map(v=>`<div class="record-media-item"><video src="${v}" preload="metadata"/></video></div>`).join('')||''}</div>`:''}${r.hasAudio?`<div class="audio-player" onclick="playHistoryAudio('${r.id}',this)"><div class="audio-icon"><span>♪</span></div><div class="audio-info"><span class="audio-duration">${r.audioDuration||'语音'} ></span><div class="audio-progress"><span class="audio-progress-time">0:00</span><div class="audio-progress-bar"><div class="audio-progress-fill" style="width:0%"></div></div><span class="audio-progress-time">${r.audioDuration||'0:00'}</span></div></div></div>`:''}<div class="record-types">${r.text?'<span class="type-tag">文字</span>':''}${r.images?.length>0?'<span class="type-tag">图片</span>':''}${r.videos?.length>0?'<span class="type-tag">视频</span>':''}${r.hasAudio?'<span class="type-tag">语音</span>':''}</div></div>`).join('');}
function initHistoryPage(){}
function filterRecords(){const ft=document.getElementById('filterType').value;let f=AppState.records;switch(ft){case'text':f=f.filter(r=>r.text&&r.text.trim().length>0);break;case'image':f=f.filter(r=>r.images&&r.images.length>0);break;case'video':f=f.filter(r=>r.videos&&r.videos.length>0);break;case'audio':f=f.filter(r=>r.hasAudio);break;}document.getElementById('historyList').innerHTML=renderHistoryList(f);document.getElementById('recordCount').textContent=`共 ${f.length} 条记录`;}
async function deleteHistoryRecord(id){Utils.showConfirm('确认删除','确定要删除这条打卡记录吗？',async()=>{await Storage.deleteCheckinRecord(id);await loadRecords();filterRecords();Utils.showToast('已删除');},null,'删除','取消',true);}
function editHistoryRecord(id){const rec=AppState.records.find(r=>r.id===id);if(!rec){Utils.showToast('记录不存在');return;}editingRecordId=id;navigateToPage('checkin');}
async function playHistoryAudio(id,el){
    const rec=AppState.records.find(r=>r.id===id);if(!rec){Utils.showToast('记录不存在');return;}if(!el)return;
    // 如果正在播放本条，则暂停
    if(AppState.audioPlayer&&AppState._playingId===id&&AppState._playingLoc==='history'){
        AppState.audioPlayer.pause();AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;
        el.querySelector('.audio-icon')&&(el.querySelector('.audio-icon').innerHTML='<span>♪</span>');return;
    }
    // 立即显示加载态
    el.querySelector('.audio-icon')&&(el.querySelector('.audio-icon').innerHTML='<span>⏳</span>');
    // 停止其他播放
    if(AppState.audioPlayer){AppState.audioPlayer.pause();AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;document.querySelectorAll('.audio-icon').forEach(e=>e.innerHTML='<span>♪</span>');}
    // 懒加载：audioData 为空时从云端获取
    if(!rec.audioData){
        el.querySelector('.audio-icon').innerHTML='<span>⏳</span>';
        Utils.showToast('加载音频中...');
        try{
            rec.audioData=await Storage.loadAudioData(id);
            if(!rec.audioData){Utils.showToast('音频数据不可用');el.querySelector('.audio-icon').innerHTML='<span>♪</span>';return;}
        }catch(e){Utils.showToast('音频加载失败');el.querySelector('.audio-icon').innerHTML='<span>♪</span>';return;}
    }
    try{
        const blob=new Blob([rec.audioData],{type:rec.audioMime||'audio/webm'}),url=URL.createObjectURL(blob),a=new Audio(url);a.preload='auto';
        // 先设置播放中状态
        const icon=el.querySelector('.audio-icon');if(icon){icon.innerHTML='<span>⏸</span>';}
        AppState.audioPlayer=a;AppState._playingId=id;AppState._playingLoc='history';
        const _fmt=t=>{const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+String(s).padStart(2,'0');};
        const times=el.querySelectorAll('.audio-progress-time'),fill=el.querySelector('.audio-progress-fill');
        a.addEventListener('timeupdate',()=>{if(times[0])times[0].textContent=_fmt(a.currentTime);if(times[1])times[1].textContent=_fmt(a.duration||0);if(fill){const pct=(a.duration>0?a.currentTime/a.duration*100:0)+'%';fill.style.width=pct;}});
        el.querySelector('.audio-progress-bar')?.addEventListener('click',function(e){e.stopPropagation();if(!a)return;const r=this.getBoundingClientRect(),pct=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));a.currentTime=pct*a.duration;});
        a.play().then(()=>{}).catch(err=>{Utils.showToast('播放失败，请重试');URL.revokeObjectURL(url);const ic2=el.querySelector('.audio-icon');if(ic2)ic2.innerHTML='<span>♪</span>';if(AppState.audioPlayer===a){AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;}});
        a.onended=()=>{URL.revokeObjectURL(url);const ic3=el.querySelector('.audio-icon');if(ic3)ic3.innerHTML='<span>♪</span>';AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;};
        a.onerror=()=>{URL.revokeObjectURL(url);Utils.showToast('语音播放失败');const ic4=el.querySelector('.audio-icon');if(ic4)ic4.innerHTML='<span>♪</span>';AppState.audioPlayer=null;AppState._playingId=null;AppState._playingLoc=null;};
    }catch(e){Utils.showToast('音频加载失败');}
}

// ==================== 个人中心页 ====================
function renderProfilePage(){const u=AppState.userInfo||{name:'',gender:'',age:null};return`<div class="page active" id="profilePage"><div class="container"><div class="card"><div class="card-title">个人信息</div><div class="form-item"><label class="form-label">姓名 *</label><input type="text" class="form-input" id="profileName" placeholder="请输入您的姓名" value="${u.name||''}" maxlength="20"></div><div class="form-item"><label class="form-label">性别 *</label><select class="form-select" id="profileGender"><option value="">请选择性别</option><option value="male" ${u.gender==='male'?'selected':''}>男</option><option value="female" ${u.gender==='female'?'selected':''}>女</option></select></div><div class="form-item"><label class="form-label">年龄 *</label><select class="form-select" id="profileAge"><option value="">请选择年龄</option>${Array.from({length:100},(_,i)=>`<option value="${i+1}" ${u.age===i+1?'selected':''}>${i+1}岁</option>`).join('')}</select></div></div><div class="card"><div class="card-title">信息预览</div><div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);"><span style="color:var(--text-secondary);">姓名</span><span style="font-weight:500;">${u.name||'-'}</span></div><div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);"><span style="color:var(--text-secondary);">性别</span><span style="font-weight:500;">${u.gender==='male'?'男':u.gender==='female'?'女':'-'}</span></div><div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;"><span style="color:var(--text-secondary);">年龄</span><span style="font-weight:500;">${u.age?u.age+'岁':'-'}</span></div></div><div style="margin-top:24px;"><button class="btn btn-primary" onclick="saveProfile()">保存信息</button><button class="btn btn-danger" style="margin-top:12px;" onclick="clearAllData()">清除所有数据</button></div></div></div>`;}
function initProfilePage(){}
function saveProfile(){const n=document.getElementById('profileName').value.trim(),g=document.getElementById('profileGender').value,a=parseInt(document.getElementById('profileAge').value);if(!n){Utils.showToast('请输入姓名');return;}if(!g){Utils.showToast('请选择性别');return;}if(!a){Utils.showToast('请选择年龄');return;}const ui={name:n,gender:g,age:a};Storage.saveUserInfo(ui);AppState.userInfo=ui;Utils.showToast('保存成功！');setTimeout(()=>renderPage('profile'),1000);}
async function clearAllData(){Utils.showConfirm('确认清除','确定要清除所有数据吗？此操作不可恢复！',async()=>{await Storage.clearAll();AppState.userInfo=null;AppState.records=[];Utils.showToast('已清除');setTimeout(()=>renderPage('profile'),1000);},null,'清除','取消',true);}

// ==================== 启动 ====================
document.addEventListener('DOMContentLoaded', startApp);
