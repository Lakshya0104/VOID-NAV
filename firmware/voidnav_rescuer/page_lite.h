// SOS page served by the rescuer node (same as SOS_Node1_single)
#pragma once
const char PAGE[] PROGMEM = R"HTML(<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SOS Node1</title>
<style>
body{margin:0;background:#0a0f1a;color:#f1f5ff;font-family:system-ui,sans-serif}
.w{max-width:480px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:12px}
h1{margin:4px 0;font-size:26px}small{color:#8a9ab3}
.g{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
button{font:inherit;color:#f1f5ff;background:#121a29;border:1px solid #22304a;border-radius:12px;padding:12px;font-size:15px}
.on{border-color:#ff3b5c!important;background:#3a1220!important}
.row{display:flex;justify-content:space-between;align-items:center;background:#121a29;border-radius:12px;padding:10px 12px}
.row b{font-size:22px;min-width:30px;text-align:center}
textarea{font:16px system-ui;background:#121a29;color:#fff;border:1px solid #22304a;border-radius:12px;padding:10px;min-height:70px}
.send{background:#ff3b5c;border:0;font-size:21px;font-weight:800;padding:18px}
.st{padding:12px;border-radius:12px;background:#121a29;opacity:.35;font-size:17px}.st.ok{opacity:1;border-left:6px solid #2fe08a}
.rep{padding:12px;border-radius:12px;border:1px solid #2fe08a;background:#0f2a1d}
#err{color:#ff8fa3;text-align:center}
</style></head><body><div class="w" id="form">
<div style="color:#2fe08a;font-size:13px">● Connected to SOS Node1 · no internet needed</div>
<h1>Send SOS<br><small>A rescue team will see this. No name or number is collected.</small></h1>
<b>What happened?</b>
<div class="g" id="cats"></div>
<div class="row"><span>People with you</span><span><button id="m">−</button> <b id="pv">1</b> <button id="p">+</button></span></div>
<div class="row"><span>Anyone injured?</span><button id="inj">No</button></div>
<div class="row"><span>Bleeding?</span><button id="bl">No</button></div>
<textarea id="note" maxlength="140" placeholder="Short note: floor, landmark, condition"></textarea>
<div id="err"></div><button class="send" id="send">SEND SOS</button></div>
<div class="w" id="stat" hidden>
<h1 id="hd">Sending…</h1><small id="sid"></small>
<div class="st" id="s0">1 · Sending <small id="tr"></small></div>
<div class="st" id="s1">2 · Delivered to command post</div>
<div class="st" id="s2">3 · Read by rescuer</div>
<div class="st" id="s3">4 · Help dispatched <small id="tm"></small></div>
<div id="reps"></div>
<div class="st ok" style="opacity:1">Stay where you are · save battery · tap metal if you hear rescuers</div>
<button id="rt" hidden>Try sending again</button><button id="again">Send another SOS</button></div>
<script>
var $=function(s){return document.querySelector(s)};
var C=[["TRAPPED","🧱 Trapped"],["COLLAPSE","🏚 Collapse"],["MEDICAL","🩺 Medical"],["FIRE","🔥 Fire"],["FLOOD","🌊 Flood"],["FOOD_WATER","💧 Food/water"],["SHELTER","⛺ Shelter"],["SAFE","✅ I am safe"],["OTHER","❔ Other"]];
var F={cat:null,people:1,injured:"no",bleeding:"no"},id=null,last="",seen=0,t=null;
$("#cats").innerHTML=C.map(function(c){return '<button data-v="'+c[0]+'">'+c[1]+'</button>'}).join("");
$("#cats").onclick=function(e){var b=e.target.closest("button");if(!b)return;F.cat=b.dataset.v;[].forEach.call($("#cats").children,function(x){x.classList.toggle("on",x===b)})};
$("#m").onclick=function(){F.people=Math.max(1,F.people-1);$("#pv").textContent=F.people};
$("#p").onclick=function(){F.people=Math.min(99,F.people+1);$("#pv").textContent=F.people};
function tog(k,el){el.onclick=function(){F[k]=F[k]=="no"?"yes":"no";el.textContent=F[k]=="yes"?"Yes":"No";el.classList.toggle("on",F[k]=="yes")}}
tog("injured",$("#inj"));tog("bleeding",$("#bl"));
var ac;function beep(f,d){try{ac=ac||new(window.AudioContext||window.webkitAudioContext)();var o=ac.createOscillator(),g=ac.createGain();o.frequency.value=f;o.type="square";g.gain.value=.25;o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+d)}catch(e){}}
function vib(p){try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}}
$("#send").onclick=function(){if(!F.cat){$("#err").textContent="Tap what happened first.";return}beep(880,.1);
 var body=JSON.stringify({cat:F.cat,people:F.people,injured:F.injured,bleeding:F.bleeding,note:$("#note").value.trim(),lang:"en"});
 fetch("/api/sos",{method:"POST",headers:{"Content-Type":"application/json"},body:body}).then(function(r){return r.json()}).then(function(j){id=j.id;last="";seen=0;$("#reps").innerHTML="";$("#form").hidden=true;$("#stat").hidden=false;poll()}).catch(function(){$("#err").textContent="Node not reachable. Stay on SOS Node1 Wi-Fi."})};
function poll(){clearTimeout(t);if(!id)return;fetch("/api/phone?id="+id).then(function(r){return r.json()}).then(function(j){
 var o=["SENDING","DELIVERED","READ","DISPATCHED"],k=j.state=="FAILED"?0:o.indexOf(j.state);
 for(var i=0;i<4;i++)$("#s"+i).classList.toggle("ok",i<=k);
 $("#sid").textContent="SOS "+j.id;$("#tr").textContent=j.state=="SENDING"?"try "+j.tries+" of "+j.max:j.state=="FAILED"?"not delivered yet":"";
 $("#hd").textContent={SENDING:"Sending…",DELIVERED:"Delivered",READ:"Read by rescuer",DISPATCHED:"Help is on the way",FAILED:"Not delivered yet"}[j.state];
 if(j.team)$("#tm").textContent="· "+j.team;$("#rt").hidden=j.state!="FAILED";
 if(last&&last!=j.state){beep(j.state=="DISPATCHED"?1318:988,.3);vib([200,100,200])}last=j.state;
 if(j.replies.length>seen){for(var i=seen;i<j.replies.length;i++){var d=document.createElement("div");d.className="rep";d.textContent="Rescue command: "+j.replies[i].text;$("#reps").appendChild(d)}if(seen||last)beep(1046,.3);vib(300);seen=j.replies.length}
}).catch(function(){});t=setTimeout(poll,1000)}
$("#rt").onclick=function(){fetch("/api/retry",{method:"POST",body:JSON.stringify({id:id})}).then(poll)};
$("#again").onclick=function(){clearTimeout(t);id=null;$("#stat").hidden=true;$("#form").hidden=false;$("#note").value=""};
</script></body></html>)HTML";
