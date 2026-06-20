---
name: illumia-chronicle
description: イルミア大陸の架空年代記（人間族・精霊族・機械族のファンタジー史）を、設定ノート（lore bible）と地続きな形で、対象日の個別ノート `skill/illumia-chronicle/イルミア年代記_YYYY-MM-DD.md` に**ジョークとして**生成するスキル。個別ノートの存在判定・抽出・検証付き作成は chronicle_io.py（決定論）、生成は main が設定ノートの few-shot に倣って行う。journal の `## イルミア年代記` 節には `templates/daily.md` が `![[イルミア年代記_<日付>]]` の埋め込みリンクを自動展開する。「年代記書いて」「今日のイルミア」「架空の歴史を生成して」で当日生成、「年代記の設定を作り直して」で過去エントリからの設定復元を起動する。対象 vault は ~/workspace/notes/obsidian/Life。
---

# illumia-chronicle: イルミア年代記の地続き生成

`~/workspace/notes/obsidian/Life`（以下 vault）の `skill/illumia-chronicle/イルミア年代記_<対象日>.md` を新規作成し、ファンタジー世界の架空の歴史を 1 件**ジョークとして**書き出す。journal 側は `templates/daily.md` の `## イルミア年代記` 節に `![[イルミア年代記_<tp.file.title>]]` が自動展開されているので、個別ノートを作れば自動的に当日 journal へ inline 表示される（手動で journal を触らない）。手動起動（cron 等の自動化は対象外）。

**最も失ってはいけない質はジョークめいた荘厳さ（厨二的トーン）**。これが落ちたら成果物の価値が消える。よって `~/.claude/persona.md` の「書き口」規範はこの skill の生成エントリ（架空年代記本体）には適用しない——設定ノート (b) の few-shot 実例と文体署名が文体の正本で、書き口の中間温度や false agency 回避・断定回避をそのまま当てると厨二的トーンが死ぬ。だから生成は subagent や workflow に出さず **main が行う**（文脈分離は few-shot のお手本を奪う——2026-06-12 の harvest 実走で接地した教訓）。逆に、機械検証可能な規則（上書き禁止・暦・書式・字数）は全て `chronicle_io.py` に退役済みで、このスキル本文には判断系だけが残る。

## 正本の所在

- **世界設定・トーン・生成方針の正本**: 設定ノート `pages/イルミア年代記.md`（lore bible・整備済み）。3 層構造——(a) attested（実エントリ由来・典拠付き）／(b) 生成方針（文体署名①〜⑤・終わり方バリエーション・連作回避・few-shot 実例）／(c) 創作・要再演（生成で増えた固有名詞ログ）。このスキル本文に複製しない（単一の正本）。
- **決定論処理の正本**: `~/.claude/skills/illumia-chronicle/chronicle_io.py`（chezmoi 管理）。modes: `inspect`（個別ノートの存在判定）／`extract`（過去 journal の節および新個別ノート群からの抽出。両方指定可）／`write`（機械検証つき個別ノート新規作成。違反は書かずに error）／`stamp`（updatedAt の ISO-T 打刻）。
- **journal 側の埋め込みリンク自動展開**: `~/workspace/notes/obsidian/Life/templates/daily.md` の `## イルミア年代記` 節に `![[イルミア年代記_<% tp.file.title %>]]` が書かれており、日次ノート作成時に Templater が `![[イルミア年代記_YYYY-MM-DD]]` を展開する。個別ノート未生成の段階では broken link になっているが、後で個別ノートを作れば自動解決する（Obsidian の動作には影響しない）。skill 起動から journal を触らないのはこの自動展開を前提にしているため。

## モードB: 生成（主用途）

1. **設定ノートを読む。** (a) が無い／空ならモードA を先に走らせる（捏造で世界を断定して続行しない）。
2. `chronicle_io.py inspect --note skill/illumia-chronicle/イルミア年代記_<対象日>.md` で個別ノートの存在を確認する（対象日の既定は当日）。
   - `exists` → **停止して報告**（上書き禁止は script が write 時にも強制するが、生成前に止まるのが安い）。会話への別案出力はユーザの明示要求があった時だけ。
   - `missing` → 続行。
3. **生成**: 設定ノート (b) の few-shot 実例・文体署名・終わり方バリエーション・連作回避方針に倣い、(a)(c) の固有名詞を再演・接続しつつ新エントリを 1 件書く。判断のポイント:
   - few-shot 実例と直近数日の (c) 末尾を**実際に読んでから**書く（実例に倣う、が抽象ラベルで終わらないように）。
   - 露骨な矛盾だけ避ける（モチーフ再演型・緩い一貫性）。
   - 無味乾燥な百科事典・真面目な神話記述に変質させない。
4. エントリ（**callout 本体のみ**——frontmatter は script 側が固定で付ける）を一時ファイルに置き、`chronicle_io.py write --note skill/illumia-chronicle/イルミア年代記_<対象日>.md --date <対象日> --entry-file <path> --skill-dir skill/illumia-chronicle/` で個別ノートを新規作成する。
   - **error**（書式・暦・字数・既存ノート・出力先ディレクトリ不在）→ 書き込まれない。直して再投入（最大 2 回。解消しなければ停止して報告）。
   - **warning**（字数目安ずれ・直近エントリとの年距離 <100）→ 内容で判断。意図的な逸脱でなければ直す。
5. **設定ノートの (c) に新固有名詞を追記**し（(a) に混ぜない）、`## 更新履歴` に当日 `[[日付]]` を冪等追記、`chronicle_io.py stamp --file pages/イルミア年代記.md` で updatedAt を打つ。
6. 完了報告: 生成エントリ・再演した既存固有名詞・(c) へ追記した新固有名詞・write の warnings・個別ノートのパス（journal 側は埋め込みリンクで自動表示される旨を併記）。

## モードA: 復元（設定ノート未整備時／「設定を作り直して」指示時）

1. `chronicle_io.py extract --journals-dir journals/ --skill-dir skill/illumia-chronicle/` で過去 journal の節および新個別ノート群から記入済みエントリを全件取る（形式揺れ——べた書き・アウトライン年別行・callout・個別ノートの frontmatter 後 callout——は script が吸収済み）。
2. 抽出結果**のみ**を素材に 3 層へ整理して設定ノートを書く。(a) は典拠日付付き・**捏造補完しない**（実エントリに無い backstory を正史にしない。Life vault 規約準拠）。(b) に文体署名と実例の丸ごと引用 1〜2 件。既存 journal / 個別ノートに creator が書いた固有名詞は (a) であって (c) ではない。
3. `stamp` で updatedAt を打ち、抽出件数・3 層の内訳を報告。

## 撃ち直した残差の記録

旧 SKILL（散文 114 行）の防御をコード層へ退役させた記録と、journal 節 → 個別ノート移行で構造的に消えた防御の記録。文脈変化時の撃ち直し用。

- **記入済みエントリの上書き禁止**（ユーザの既存エントリ破壊防止）→ `inspect` の存在判定＋ `write` の existence チェックで二重化。
- **節境界の踏み越え禁止**（スケジュール／TODO 巻き込み防止）→ **個別ノート方式で構造的に消滅**（journal 節への書き込みをしないため、他節と物理的に分離されない問題自体が無くなった）。journal 側で同種の事故が起きるとしたら `templates/daily.md` の Templater 展開ミスのみで、これは別 skill の領域。
- **暦ルール**（年 600〜900 番台・月日=対象日の実月日）→ `write` の検証で書き込み拒否。
- **callout 書式・ヘッダに `：` 禁止・Templater 構文禁止** → 同上（個別ノートになっても entry-file の検証として継続）。
- **字数 80〜110**（実エントリ 68〜95 字より冗長にしない）→ 60〜140 逸脱は error、80〜110 ずれは warning（創作の幅を残す段付け）。
- **復元時の形式揺れ対応**（行頭 `-`・年別行・`<? ?>` スキップ・新個別ノートの frontmatter 後 callout）→ `extract` の正規表現。観測が決定論化され「捏造補完しない」が入力経路で構造化。
- **連作回避の年距離**（直近から目安 100 年以上）→ `write` の warning。直近判定は `--skill-dir` 経由（過去 journal でなく、新個別ノート群から最新を取る——移行後の連続性は個別ノート側で見る）。
- **updatedAt の ISO-T 実値打刻** → `stamp`。

## やってはいけないこと（判断系のみ。機械系は script が拒否する）

- トーンを落として真面目な百科事典・神話事典に変質させる（few-shot 実例を読まずに書かない）
- 設定ノート未整備のまま世界を勝手に断定して生成する（先にモードA）
- 復元で実エントリに無い backstory を attested として捏造する／生成で作った固有名詞を (a) に混ぜる（(c) に隔離）
- `write` の error を script を介さない直接編集で回避する（機械ゲートの意味が消える）
- 過去 journal の `## イルミア年代記` 節を後から書き換える／旧形式エントリを個別ノートへ移植する（移行後の過去ログはそのまま残し、復元素材として extract で参照する。書き換えると典拠が崩れて (a) の再構築が不可逆に汚れる）
- journal 側に手で `![[イルミア年代記_…]]` を書き足す／編集する（埋め込みリンクは `templates/daily.md` の Templater 展開が単一 writer。手で触ると更新源が分散して drift する）
- `imports/kindle/`・`imports/wallabag/`・他スキルの領域を触る
