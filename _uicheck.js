// ica-forge · UI wiring check with a minimal DOM stub (native Node)
// Run: node _uicheck.js    Expect: PASS x/y ALL GREEN
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const eng = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
const ui = html.match(/<script id="ui">([\s\S]*?)<\/script>/);
if(!eng || !ui) throw new Error("scripts not found");

let pass = 0, total = 0;
const lines = [];
function ok(name, cond, info){ total++; if(cond) pass++; lines.push(`${cond?"PASS":"FAIL"}  ${name}  ${info||""}`); }

// ---- DOM stub ----
const drawCalls = { scatter: 0, conv: 0 };
function makeCtx2d(name){
  let cached = null;
  const rec = () => { drawCalls[name]++; };
  const ctx = {
    fillStyle: "", strokeStyle: "", font: "", lineWidth: 1,
    clearRect(){}, fillRect(){ rec(); }, fillText(){}, beginPath(){}, arc(){}, fill(){}, stroke(){},
    moveTo(){}, lineTo(){}, closePath(){}, save(){}, restore(){},
    createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4), width:w, height:h }; },
    putImageData(){ rec(); }, getImageData(x,y,w,h){ return { data: new Uint8ClampedArray(w*h*4), width:w, height:h }; },
  };
  return () => { if(!cached) cached = ctx; return cached; };
}
const listeners = {};
function makeEl(id){
  const el = {
    id, value: id === "g" ? "kurtosis" : (id === "mode" ? "deflation" : ""),
    textContent: "", _html: "", width: 520, height: 240,
    addEventListener(ev, fn){ (listeners[id] = listeners[id] || []).push(fn); },
    appendChild(child){ this._html += (child && (child._html || "")) || ""; },
    set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
  };
  if(id === "scatter" || id === "conv") el.getContext = makeCtx2d(id);
  return el;
}
const els = {};
const document = {
  getElementById(id){ if(!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement(tag){ return makeEl(tag); },
};

// node's createElement returns el without getContext for 'li' -> fine
const ctx = { console, Math, Float64Array, Array, JSON, Object, isFinite, Infinity, Number, String, Boolean, Date, document };
ctx.globalThis = ctx;
const vm = require("vm");
vm.createContext(ctx);
vm.runInContext(eng[1], ctx, { filename: "engine.js" });
ok("engine 注入 globalThis.ICA", !!ctx.ICA && typeof ctx.ICA.run === "function", "ICA.run=" + (ctx.ICA ? typeof ctx.ICA.run : "none"));

// UI already wrapped in IIFE -> top-level return is legal
vm.runInContext(ui[1], ctx, { filename: "ui.js" });

// auto-run on load should have populated status + checks + canvas
ok("status 已更新 (auto-run)", /完成|错误/.test(els.status.textContent), "status='" + els.status.textContent + "'");
ok("checks 面板已填充", els.checks._html.length > 0, "len=" + els.checks._html.length);
ok("checks 含 8 项 + 总结", (els.checks._html.match(/<span/g) || []).length >= 16, "span=" + (els.checks._html.match(/<span/g) || []).length);
ok("scatter 画布已绘制", drawCalls.scatter > 0, "calls=" + drawCalls.scatter);
ok("conv 画布已绘制", drawCalls.conv > 0, "calls=" + drawCalls.conv);

// click "run" with tanh + symmetric
els.g.value = "tanh"; els.mode.value = "symmetric";
const runFns = listeners["run"] || [];
ok("run 按钮已绑定", runFns.length > 0, "handlers=" + runFns.length);
if(runFns.length){
  runFns[0]();
  ok("切换 tanh/symmetric 后仍完成", /完成/.test(els.status.textContent), "status='" + els.status.textContent + "'");
  ok("状态串含模式", /mode=symmetric/.test(els.status.textContent), els.status.textContent);
}

console.log(lines.join("\n"));
console.log(`\n=== ${pass}/${total} ${pass === total ? "ALL GREEN" : "FAILURES"} ===`);
if(pass !== total) process.exit(1);
