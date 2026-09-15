// ica-forge · headless invariant smoke test (native Node, no vm)
// Run: node _smoke.js    Expect: 16/16 ALL GREEN
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if(!m) throw new Error("engine script not found");
// eslint-disable-next-line no-new-func
new Function(m[1])();
const ICA = globalThis.ICA;
if(!ICA) throw new Error("globalThis.ICA not exposed");

let pass = 0, total = 0;
const lines = [];
function ok(name, cond, info){
  total++;
  if(cond) pass++;
  lines.push(`${cond ? "PASS" : "FAIL"}  ${name}  ${info || ""}`);
}

function maxAbsDev(M, ref){
  let mx = 0;
  for(let i = 0; i < M.length; i++)
    for(let j = 0; j < M[i].length; j++){
      const v = (ref === undefined) ? Math.abs(M[i][j]) : Math.abs(M[i][j] - ref);
      if(v > mx) mx = v;
    }
  return mx;
}
function covOf(X){
  const D = X.length, N = X[0].length, C = ICA.zeros(D, D);
  for(let i = 0; i < D; i++) for(let j = i; j < D; j++){
    let s = 0; for(let t = 0; t < N; t++) s += X[i][t] * X[j][t];
    s /= N; C[i][j] = s; C[j][i] = s;
  }
  return C;
}
function maxDiagDev(C){
  let mx = 0;
  for(let i = 0; i < C.length; i++) for(let j = 0; j < C.length; j++){
    const v = (i === j) ? Math.abs(C[i][j] - 1) : Math.abs(C[i][j]);
    if(v > mx) mx = v;
  }
  return mx;
}

// ---------- 1) eigSym exact on [[2,1],[1,2]] -> {3,1} ----------
{
  const M = [[2,1],[1,2]];
  const { eigenvalues: lam, eigenvectors: V } = ICA.eigSym(M);
  const sorted = Array.from(lam).sort((a,b)=>b-a);
  let res = 0;
  for(let k = 0; k < 2; k++){
    const v = [V[0][k], V[1][k]];
    const Av = [M[0][0]*v[0]+M[0][1]*v[1], M[1][0]*v[0]+M[1][1]*v[1]];
    for(let i = 0; i < 2; i++) res = Math.max(res, Math.abs(Av[i] - lam[k]*v[i]));
  }
  ok("eigSym 精确解 {3,1}", Math.abs(sorted[0]-3)<1e-12 && Math.abs(sorted[1]-1)<1e-12 && res<1e-12,
     `λ=[${sorted.map(x=>x.toFixed(6))}] residual=${res.toExponential(2)}`);
}

// ---------- 2) eigSym residual on random symmetric 5x5 ----------
{
  const rng = ICA.mulberry32(11);
  const n = 5, A = ICA.zeros(n,n);
  for(let i=0;i<n;i++) for(let j=i;j<n;j++){ const v=ICA.randn(rng); A[i][j]=v; A[j][i]=v; }
  const { eigenvalues: lam, eigenvectors: V } = ICA.eigSym(A);
  let res = 0;
  for(let k=0;k<n;k++){
    const v = []; for(let i=0;i<n;i++) v.push(V[i][k]);
    const Av = []; for(let i=0;i<n;i++){ let s=0; for(let j=0;j<n;j++) s+=A[i][j]*v[j]; Av.push(s); }
    for(let i=0;i<n;i++) res = Math.max(res, Math.abs(Av[i]-lam[k]*v[i]));
    // orthonormality
    for(let l=k;l<n;l++){
      let d=0; for(let i=0;i<n;i++) d+=V[i][k]*V[i][l];
      const want = (k===l)?1:0;
      res = Math.max(res, Math.abs(d-want));
    }
  }
  ok("eigSym 5×5 残差+正交", res < 1e-9, `residual=${res.toExponential(2)}`);
}

// ---------- shared dataset: D=3, N=800 ----------
const N = 800, D = 3;
const setup = (function(){
  const rng = ICA.mulberry32(7);
  const S0 = ICA.genSources(rng, D, N);
  const A = ICA.randomMix(rng, D);
  const X = ICA.matMul(A, S0);
  return { S0, A, X };
})();
const { S0, A, X } = setup;
const res = ICA.run(X, { g: "kurtosis", mode: "deflation", seed: 7, maxIter: 400, tol: 1e-9 });
const { Xc, K, Z, W, S } = res;

// ---------- 3) centering ----------
{
  let mx = 0;
  for(let i=0;i<D;i++){ let s=0; for(let t=0;t<N;t++) s+=Xc[i][t]; s/=N; mx=Math.max(mx,Math.abs(s)); }
  ok("中心化后均值≈0", mx < 1e-9, `max|mean|=${mx.toExponential(2)}`);
}

// ---------- 4) whitening cov(Z)=I ----------
{
  const d = maxDiagDev(covOf(Z));
  ok("白化 cov(Z)=I", d < 1e-5, `maxdev=${d.toExponential(2)}`);
}

// ---------- 5) W·Wᵀ = I ----------
{
  const WWt = ICA.matMul(W, ICA.matT(W));
  const d = maxDiagDev(WWt);
  ok("解混矩阵 W 正交 (W·Wᵀ=I)", d < 1e-5, `maxdev=${d.toExponential(2)}`);
}

// ---------- 6) recovered cov(S)=I ----------
{
  const d = maxDiagDev(covOf(S));
  ok("恢复源 cov(S)=I", d < 1e-4, `maxdev=${d.toExponential(2)}`);
}

// ---------- 7) known-mixing recovery |corr|>0.9 for all D ----------
{
  let matched = 0, worst = 1;
  for(let k=0;k<D;k++){
    let best = 0;
    for(let j=0;j<D;j++){ const c = Math.abs(ICA.corr(S[k], S0[j])); if(c>best) best=c; }
    if(best > 0.9) matched++;
    worst = Math.min(worst, best);
  }
  ok("已知混合可恢复 (|corr|>0.9 ×3)", matched === D, `matched=${matched}/${D} worst=${worst.toFixed(4)}`);
}

// ---------- 8) W·K·A ≈ 蒙多项式矩阵 (每列归一后 = 有符号置换) ----------
// 注意：源方差不等 ⇒ W·K·A = 置换 × diag(1/√var)，故须先按列归一化再判置换。
{
  const WK = ICA.matMul(W, K);
  const M = ICA.matMul(WK, A);
  const Mn = M.map(r => Array.from(r));
  let colNormOk = true;
  for(let j=0;j<D;j++){
    let s=0; for(let i=0;i<D;i++) s += Mn[i][j]*Mn[i][j];
    s = Math.sqrt(s);
    if(s < 1e-9){ colNormOk = false; continue; }
    for(let i=0;i<D;i++) Mn[i][j] /= s;
  }
  let dev = 0;
  for(let i=0;i<D;i++){
    for(let j=0;j<D;j++){
      const a = Math.abs(Mn[i][j]);
      const isPeak = a > 0.5;
      if(isPeak) dev = Math.max(dev, Math.abs(a-1));
      else dev = Math.max(dev, a);
    }
  }
  ok("W·K·A 列归一 = 置换(±1)", dev < 0.25 && colNormOk, `maxdev=${dev.toFixed(4)}`);
}

// ---------- 9) determinism (same seed -> identical W) ----------
{
  const r2 = ICA.run(X, { g: "kurtosis", mode: "deflation", seed: 7, maxIter: 400, tol: 1e-9 });
  let d = 0;
  for(let i=0;i<D;i++) for(let j=0;j<D;j++) d = Math.max(d, Math.abs(W[i][j]-r2.W[i][j]));
  ok("确定性 (同 seed → 逐位一致)", d === 0, `maxdiff=${d}`);
}

// ---------- 10) no NaN/Inf ----------
{
  let bad = 0;
  for(let i=0;i<D;i++) for(let t=0;t<N;t++){ if(!isFinite(S[i][t])) bad++; if(!isFinite(Z[i][t])) bad++; if(!isFinite(W[i][0])) bad++; }
  ok("无 NaN/Inf", bad === 0, `bad=${bad}`);
}

// ---------- 11) fixed-point converged (deltas -> 0, iters < maxIter) ----------
{
  const allSmall = res.conv.every(d => d < 1e-6);
  const iterOk = res.iters.every(k => k > 0 && k <= 400);
  ok("定点迭代收敛 ‖Δw‖→0", allSmall && iterOk,
     `deltas=[${res.conv.map(x=>x.toExponential(1))}] iters=[${res.iters}]`);
}

// ---------- 12) tanh contrast also recovers ----------
{
  const rt = ICA.run(X, { g: "tanh", mode: "deflation", seed: 7, maxIter: 400, tol: 1e-9 });
  let matched = 0, worst = 1;
  for(let k=0;k<D;k++){
    let best = 0;
    for(let j=0;j<D;j++){ const c = Math.abs(ICA.corr(rt.S[k], S0[j])); if(c>best) best=c; }
    if(best > 0.9) matched++;
    worst = Math.min(worst, best);
  }
  ok("tanh 对照函数同样恢复", matched === D, `matched=${matched}/${D} worst=${worst.toFixed(4)}`);
}

// ---------- 13) symmetric mode also recovers + orthogonal ----------
{
  const rs = ICA.run(X, { g: "tanh", mode: "symmetric", seed: 7, maxIter: 400, tol: 1e-9 });
  let matched = 0, worst = 1;
  for(let k=0;k<D;k++){
    let best = 0;
    for(let j=0;j<D;j++){ const c = Math.abs(ICA.corr(rs.S[k], S0[j])); if(c>best) best=c; }
    if(best > 0.9) matched++;
    worst = Math.min(worst, best);
  }
  const orth = maxDiagDev(ICA.matMul(rs.W, ICA.matT(rs.W)));
  ok("symmetric 模式恢复 + W 正交", matched === D && orth < 1e-4,
     `matched=${matched}/${D} worst=${worst.toFixed(4)} orth=${orth.toExponential(2)}`);
}

// ---------- 14) D=2 works ----------
{
  const rng = ICA.mulberry32(3);
  const S0b = ICA.genSources(rng, 2, 600);
  const Ab = ICA.randomMix(rng, 2);
  const Xb = ICA.matMul(Ab, S0b);
  const rb = ICA.run(Xb, { g: "kurtosis", mode: "deflation", seed: 3 });
  let matched = 0;
  for(let k=0;k<2;k++){ let best=0; for(let j=0;j<2;j++){ const c=Math.abs(ICA.corr(rb.S[k],S0b[j])); if(c>best)best=c; } if(best>0.9) matched++; }
  ok("D=2 双向恢复", matched === 2, `matched=${matched}/2`);
}

// ---------- 15) D=4 works ----------
{
  const rng = ICA.mulberry32(5);
  const S0b = ICA.genSources(rng, 4, 1000);
  const Ab = ICA.randomMix(rng, 4);
  const Xb = ICA.matMul(Ab, S0b);
  const rb = ICA.run(Xb, { g: "tanh", mode: "deflation", seed: 5 });
  let matched = 0;
  for(let k=0;k<4;k++){ let best=0; for(let j=0;j<4;j++){ const c=Math.abs(ICA.corr(rb.S[k],S0b[j])); if(c>best)best=c; } if(best>0.9) matched++; }
  ok("D=4 四路恢复", matched === 4, `matched=${matched}/4`);
}

// ---------- 16) corr helper sanity ----------
{
  const x = [1,2,3,4,5];
  const c1 = ICA.corr(x, x);
  const c2 = ICA.corr(x, x.map(v=>-v));
  ok("corr 助手 corr(x,x)=1, corr(x,-x)=-1", Math.abs(c1-1)<1e-12 && Math.abs(c2+1)<1e-12,
     `c1=${c1.toFixed(6)} c2=${c2.toFixed(6)}`);
}

console.log(lines.join("\n"));
console.log(`\n=== ${pass}/${total} ${pass === total ? "ALL GREEN" : "FAILURES"} ===`);
if(pass !== total) process.exit(1);
