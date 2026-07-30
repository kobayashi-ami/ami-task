# AmiTask — 先行研究ノート（ちらつき・可読性・疲労）

浮遊する膜（常時最前面ウィジェット）と、その中に置く文字を、
**「読めるが疲れない」**水準で設計するための先行研究の整理と、そこから導いた
設計パラメータ。

---

## 1. ちらつき（flicker）

### 1.1 知覚の前提
- **臨界フリッカー融合頻度 (CFF)**：明滅が「連続」に見える下限周波数。輝度・
  コントラストで変動し、おおむね **50–90 Hz**。網膜照度の対数に比例して上がる
  （**Ferry–Porter 則**）。[Nature/SciRep], [MDPI Vision]
- **周辺視は中心視より明滅に敏感**。動く/明滅する要素を視野の端に置くと、たとえ
  中心で作業していても知覚・注意を奪われる。[MDPI Vision], [NN/g]
- 高コントラストの**空間エッジ**があると、人は 500 Hz 級の明滅アーティファクトすら
  検知しうる。→ **輪郭が硬い・高コントラストなほどチラつきは目立つ**。[Nature/SciRep]

### 1.2 本アプリのちらつきの技術的根因
- **これは既知の Electron/macOS バグ**：透明・フレームレスウィンドウを
  **移動/リサイズすると再描画がずれてチラつく/ゴーストが出る**。
  （issue #20325、修正 PR #46392/#46393＝#46353 のバックポート）[electron#20325]
- AmiTask は膜を漂わせるため **毎フレーム OS ウィンドウを移動**しており、これが
  バグを恒常的に踏んでいる。加えて **同一レベル(screen-saver)の透明ウィンドウが
  重なる**と、コンポジタの再順序付けでもチラつく。
- さらに毎フレームの移動＋各膜が個別 WebGL コンテキストで 60fps 描画 → **高CPU**。

### 1.3 対策（根本 → 応急）
1. **根本（推奨）**：**画面全体を覆う透明・クリックスルーのオーバーレイを1枚**だけ
   置き、**全ての膜をその1つの WebGL キャンバス内のオブジェクトとして描画・移動**
   する。OS ウィンドウは動かさない＝**バグの発生源そのものを消す**。副次効果として
   コンテキストが1つになり **CPU も激減**。マウスは `setIgnoreMouseEvents(true,
   {forward:true})` で通常はデスクトップへ透過させ、膜の上に来た時だけ当たり判定で
   有効化する。
2. **補強**：Electron を上記修正入りのバージョンへ更新。
3. **共通**：後述の通り**動き（ドリフト・揺らぎ）を遅く・控えめに**する。周辺視の
   運動感受性の観点からも、これがチラつき/疲労の双方に効く。[NN/g], [Lordicon]

---

## 2. 文字の可読性と視覚疲労（asthenopia）

### 2.1 コントラスト
- **WCAG**：本文 **4.5:1（AA）/ 7:1（AAA）**、大きめ文字は 3:1 / 4.5:1。下回ると
  誰にとっても読みにくく疲れる。[W3C WCAG], [WebAIM]
- ただし**純黒#000×純白#fff の極端コントラストは過刺激**で、長時間で疲れる。
  暗背景では白文字が**滲む（ハレーション）**＝乱視の人に特に辛い。
  → **オフ黒/オフ白＋濃いグレー**が推奨（例 背景 `#1E1E1E` 系、文字は純白でなく
  わずかに灰/暖色寄り）。[UX Movement], [rs999 halation]
- **含意**：「読みやすすぎ（＝最大コントラスト）」も疲れる。狙うべきは
  **中〜高コントラスト（約 5–7:1）**の“ちょうど良い谷”。ユーザーの直感と一致。

### 2.2 極性（polarity）とサイズ
- 小さい文字・精読では**ポジティブ極性（暗字×明背景）**が有利で、差は
  **文字が小さいほど拡大**。暗背景×明字（ネガティブ極性）は暗所では疲労が少ない
  が、小さい文字だと不利。[ResearchGate legibility], [MDPI Sensors]
- 文字色では**赤が最も疲れ、黄が最も疲れにくい**という報告。[MDPI/RG fatigue]
- **含意**：本アプリは暗い膜×明るい字（ネガティブ極性）。**小ささを補うため、
  文字は少し大きく・太く**し、背景を安定させる。

### 2.3 透明/雑然背景の上の文字
- 透明ガラス化でデスクトップが透けると**背景輝度が不定**になり、コントラストが
  保証されない＝可読性が崩れる。**文字専用の下地（backplate）**で局所的に背景を
  固定するのが定石。[WebAIM]

### 2.4 動き（motion）と疲労
- **周辺視の運動は bottom-up に注意を奪う**。意味のない・ループする動きは
  「止められない」ため疲労・不快・不安感（急かされる感覚）を生む。**点滅は最悪**。
  [NN/g animation], [Lordicon], [W3C 2.3.3]
- **含意**：常時ドリフト＋速い揺らぎ＝“周辺視でループする運動”そのもの。
  **動きを遅く・小さく**、必要なら**アイドル時のみ微動**にするのが疲労低減の鍵。

---

## 3. AmiTask への設計判断（この研究から導く実装）

### ちらつき
- **[根本] 全画面1枚の透明クリックスルー・オーバーレイに全膜を内包描画**へアーキ
  テクチャ変更（OS ウィンドウを毎フレーム動かさない）。CPU も同時に解決。
- 動きの周波数・速度を下げる（下記）。

### 可読性（“疲れない”を実践）
- **NOW の文字裏に局所フロスト下地**（角丸・ぼかし・半透明の暗パネル）を敷き、
  デスクトップに依らず **コントラスト比を約 6:1 に固定**。
- 文字は**純白をやめオフ白**（例 `#E7ECF3`）。**発光シャドウ（ハレーション源）を
  大幅減**し、細く薄い影のみに。
- 文字を**わずかに大きく/太く**（ネガティブ極性＋小サイズの不利を補償）。
- 下地の暗さは**純黒でなく濃グレー**（滲み低減）。

### 動き（疲労・チラつき・CPU に共通で効く）
- ドリフト速度・揺らぎ速度・脈動を**現状比で明確に低速化**。描画は既に ~35fps
  だが、**周辺運動を穏やかに**して「視界の端でうるさい」状態を解消。

---

## 参考文献（出典）
- Davis et al., *Humans perceive flicker artifacts at 500 Hz*, Scientific Reports — https://www.nature.com/articles/srep07861
- *Peripheral Flicker Fusion at High Luminance: Beyond the Ferry–Porter Law*, MDPI Vision — https://www.mdpi.com/2411-5150/7/1/26
- Electron issue #20325 *macOS transparent window flickers on move/position change* — https://github.com/electron/electron/issues/20325
- Electron PR #46393 *fix: flicker and ghosting in transparent windows on macOS* — https://github.com/electron/electron/pull/46393
- W3C, *Understanding SC 1.4.3 Contrast (Minimum)* — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WebAIM, *Contrast and Color Accessibility* — https://webaim.org/articles/contrast/
- UX Movement, *Why You Should Never Use Pure Black for Text or Backgrounds* — https://uxmovement.com/content/why-you-should-never-use-pure-black-for-text-or-backgrounds/
- *Halation/Bloom in Dark-Mode Design* — https://www.rs999.in/blog/halation-bloom-in-dark-mode-graphics-why-your-white-text-vibrates-on-black-and-the-anti-glow-fix-pros-use
- NN/g, *Dark Mode vs. Light Mode* — https://www.nngroup.com/articles/dark-mode/
- *The Effect of Ambient Illumination and Text Color on Visual Fatigue under Negative Polarity*, MDPI Sensors — https://www.mdpi.com/1424-8220/24/11/3516
- NN/g, *The Role of Animation and Motion in UX* — https://www.nngroup.com/articles/animation-purpose-ux/
- Lordicon, *Too much motion hurts UX* — https://lordicon.com/blog/too-much-motion-hurts-ux-heres-why
- W3C, *Understanding SC 2.3.3 Animation from Interactions* — https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions
