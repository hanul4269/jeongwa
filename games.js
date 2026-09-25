(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const names = Array.from({length:12}, (_,i) => `생선${i+1}`);
  const prizes = Array.from({length:12}, (_,i) => i === 0 ? '당첨' : '꽝');
  let count = 4, rungs = [], paths = [], mapping = [], revealed = false, running = false;
  const x = col => (col + .5) * 100;
  const svg = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key,value));
    return node;
  };
  function build() {
    $('board').style.setProperty('--count',count);
    $('board').style.minWidth = `${Math.max(420,count*85)}px`;
    $('count').textContent = `${count}명`;
    for (const [id,values] of [['names',names],['prizes',prizes]]) {
      $(id).replaceChildren();
      for (let i=0;i<count;i++) {
        const slot = document.createElement('div'); slot.className='slot';
        if (id === 'names') {
          const button = document.createElement('button'); button.textContent = i+1;
          button.setAttribute('aria-label',`${i+1}번 참가자 출발`);
          button.addEventListener('click',()=>run(i)); slot.append(button);
        }
        const input = document.createElement('input'); input.value=values[i]; input.maxLength=30;
        input.setAttribute('aria-label',`${i+1}번 ${id==='names'?'참가자':'결과'}`);
        input.addEventListener('input',()=>{values[i]=input.value; $('result-list').hidden=true;});
        slot.append(input); $(id).append(slot);
      }
    }
    shuffle();
  }
  function shuffle() {
    if (running) return;
    rungs=[];
    // One bridge per row prevents ambiguous intersections, so every result is unique.
    for(let row=0;row<count*4;row++) rungs.push({col:Math.floor(Math.random()*(count-1)),y:15+row*310/(count*4-1)});
    paths=[];mapping=[];
    for(let start=0;start<count;start++) {
      let col=start, points=[[x(col),0]];
      for(const rung of rungs) if(col===rung.col||col===rung.col+1) {
        points.push([x(col),rung.y]); col=col===rung.col?col+1:col-1; points.push([x(col),rung.y]);
      }
      points.push([x(col),340]); paths.push(points); mapping.push(col);
    }
    revealed=false; $('result-list').hidden=true;
    $('status').textContent='새 사다리를 준비했어요. 참가자 번호를 누르면 출발합니다.';
    draw(); lock(false);
  }
  function draw() {
    $('ladder').replaceChildren(); $('ladder').setAttribute('viewBox',`0 0 ${count*100} 340`);
    for(let col=0;col<count;col++) $('ladder').append(svg('line',{x1:x(col),x2:x(col),y1:0,y2:340,stroke:'#394653','stroke-width':3}));
    if(revealed) for(const rung of rungs) $('ladder').append(svg('line',{x1:x(rung.col),x2:x(rung.col+1),y1:rung.y,y2:rung.y,stroke:'#526579','stroke-width':3}));
  }
  function lock(value) {
    running=value;
    document.querySelectorAll('#ladder-panel button,#ladder-panel input').forEach(node=>node.disabled=value);
    $('minus').disabled=value||count<=2; $('plus').disabled=value||count>=12;
  }
  function valid() {
    const input=[...document.querySelectorAll('#ladder-panel input')].find(node=>!node.value.trim());
    if(input){$('status').textContent='참가자 이름과 결과를 모두 입력해주세요.';input.focus();return false;}return true;
  }
  async function run(index) {
    if(running||!valid())return;
    revealed=true;draw();lock(true);$('result-list').hidden=true;
    $('status').textContent=`${names[index]} 님이 내려가는 중…`;
    const path=svg('polyline',{points:paths[index].map(p=>p.join(',')).join(' '),fill:'none',stroke:'#80c0ff','stroke-width':5,'stroke-linejoin':'round'});
    $('ladder').append(path);const length=path.getTotalLength();
    const animation=path.animate([{strokeDasharray:`${length}`,strokeDashoffset:length},{strokeDasharray:`${length}`,strokeDashoffset:0}],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?1:1800,easing:'linear',fill:'forwards'});
    await animation.finished;
    $('status').textContent=`${names[index]} → ${prizes[mapping[index]]}`;lock(false);
  }
  $('minus').onclick=()=>{if(count>2){count--;build();}};
  $('plus').onclick=()=>{if(count<12){count++;build();}};
  $('shuffle').onclick=shuffle;
  $('reveal').onclick=()=>{revealed=true;draw();$('status').textContent='사다리를 공개했어요. 참가자 번호를 눌러 경로를 확인하세요.';};
  $('results').onclick=()=>{
    if(!valid())return;revealed=true;draw();$('result-list').replaceChildren();
    mapping.forEach((target,index)=>{const row=document.createElement('div');row.textContent=`${names[index]} → ${prizes[target]}`;$('result-list').append(row);});
    $('result-list').hidden=false;$('status').textContent='전체 결과를 공개했어요.';
  };
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
    const pinball=button.dataset.mode==='pinball';
    $('ladder-panel').hidden=pinball;$('pinball-panel').hidden=!pinball;
    document.querySelectorAll('[data-mode]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});
    if(pinball&&!$('pinball-frame').getAttribute('src'))$('pinball-frame').src=$('pinball-frame').dataset.src;
  });
  $('fullscreen').onclick=async()=>{
    try {await $('pinball-stage').requestFullscreen();}
    catch {window.open($('pinball-frame').dataset.src,'_blank','noopener');}
  };
  build();
  // Resize the embedding frame to content, leaving page scrolling to the parent.
  const reportHeight = () => {
    if (window.parent !== window) window.parent.postMessage({
      type: 'jeongwa-game-height', height: Math.ceil(document.querySelector('main').getBoundingClientRect().height)
    }, window.location.origin);
  };
  new ResizeObserver(reportHeight).observe(document.querySelector('main'));
  window.addEventListener('load', reportHeight);
})();
