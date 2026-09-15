// ica-forge · probe: dump real numbers (recovery table, non-Gaussianity, convergence)
// Run: node _probe.js  -> prints + writes _probe.txt
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
new Function(m[1])();
const ICA = globalThis.ICA;

const out = [];
const say = (s) => { out.push(s); console.log(s); };

const D = 3, N = 1000;
const rng = ICA.mulberry32(7);
const S0 = ICA.genSources(rng, D, N);
const A = ICA.randomMix(rng, D);
const X = ICA.matMul(A, S0);

function kurtosis(v){
  const n = v.length; let m1 = 0;
  for(let i = 0; i < n; i++) m1 += v[i]; m1 /= n;
  let m2 = 0, m4 = 0;
  for(let i = 0; i < n; i++){ const d = v[i] - m1; m2 += d * d; m4 += d * d * d * d; }
  m2 /= n; m4 /= n;
  return m4 / (m2 * m2) - 3;
}

say("=== ica-forge probe ===");
say(`数据: D=${D}, N=${N}, 混合矩阵 A 随机可逆`);
say("");

const res = ICA.run(X, { g: "kurtosis", mode: "deflation", seed: 7, maxIter: 400, tol: 1e-9 });

// recovery correlation matrix
say("恢复相关性 |corr(ŝ_k, s_j)|  (每行应有一个 ≈1):");
say("        s0      s1      s2");
for(let k = 0; k < D; k++){
  let row = `ŝ${k}  `;
  for(let j = 0; j < D; j++){
    const c = Math.abs(ICA.corr(res.S[k], S0[j]));
    row += c.toFixed(4).padStart(8);
  }
  say(row);
}
say("");

// aligned non-Gaussianity: recovered ŝ_k vs its matched true source (should agree, since ŝ≈±s_j)
say("恢复源与其匹配真源的 |kurtosis| (应逐项一致 ⇒ 该源被正确分离):");
for(let k = 0; k < D; k++){
  let best = 0, bj = -1;
  for(let j = 0; j < D; j++){ const c = Math.abs(ICA.corr(res.S[k], S0[j])); if(c > best){ best = c; bj = j; } }
  const ks = Math.abs(kurtosis(res.S[k]));
  const kt = Math.abs(kurtosis(S0[bj]));
  say(`  ŝ${k} ↔ s${bj} (corr ${best.toFixed(4)}):  |κ|=${ks.toFixed(3)} vs 真源 ${kt.toFixed(3)}  Δ=${Math.abs(ks-kt).toFixed(4)}`);
}
say("");
say("对比: 混合信号 |kurtosis| (混合使分布更接近高斯, 非高斯性被稀释):");
for(let k = 0; k < D; k++) say(`  混合 x${k}: |κ|=${Math.abs(kurtosis(X[k])).toFixed(3)}`);
say("");

// convergence deltas
say(`收敛: 各成分迭代 ${JSON.stringify(res.iters)} 次, 末次 ‖Δw‖ = ${JSON.stringify(res.conv.map(x=>x.toExponential(2)))}`);
say("");

// permutation matrix (column-normalized)
const WK = ICA.matMul(res.W, res.K);
const M = ICA.matMul(WK, A);
const Mn = M.map(r => Array.from(r));
for(let j = 0; j < D; j++){
  let s = 0; for(let i = 0; i < D; i++) s += Mn[i][j] * Mn[i][j];
  s = Math.sqrt(s);
  for(let i = 0; i < D; i++) Mn[i][j] /= s;
}
say("W·K·A 列归一 (应为有符号置换):");
for(let i = 0; i < D; i++){
  say("  [" + Mn[i].map(v => v.toFixed(3).padStart(7)).join(" ") + " ]");
}
say("");

// whitening check
const CZ = (function(){ const C = ICA.zeros(D, D); for(let i=0;i<D;i++) for(let j=i;j<D;j++){ let s=0; for(let t=0;t<N;t++) s+=res.Z[i][t]*res.Z[j][t]; s/=N; C[i][j]=s; C[j][i]=s; } return C; })();
say("白化后 cov(Z) (应 ≈ I):");
for(let i = 0; i < D; i++) say("  [" + Array.from(CZ[i]).map(v => v.toFixed(4).padStart(8)).join(" ") + " ]");
say("");

// tanh vs kurtosis recovery agreement
const rt = ICA.run(X, { g: "tanh", mode: "deflation", seed: 7 });
let worst = 1;
for(let k = 0; k < D; k++){ let best = 0; for(let j = 0; j < D; j++){ const c = Math.abs(ICA.corr(rt.S[k], S0[j])); if(c > best) best = c; } worst = Math.min(worst, best); }
say(`tanh 对照：最差成分恢复 |corr| = ${worst.toFixed(4)}`);

fs.writeFileSync(path.join(__dirname, "_probe.txt"), out.join("\n"), "utf8");
