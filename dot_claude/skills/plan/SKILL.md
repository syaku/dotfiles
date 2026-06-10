---
name: plan
description: 依頼を整理して ~/workspace/tasks/<slug>/plan.md に計画を書き、承認まで進めるスキル。standalone でも /develop から呼ばれてもよい。フロントマターで Bash/Edit がツール層ブロックされ、計画フェーズの実行を抑制する。「計画を立てて」「plan して」などの依頼で起動する。
disallowed-tools: Bash Edit
---

# plan: 計画フェーズ

依頼を read-only で調査・整理し、`~/workspace/tasks/<slug>/plan.md` に計画を書き、ユーザの承認を取って終了するスキル。実装には進まない（実装は呼び出し元の責務）。

## 厳守プロトコル

- **`plan.md` を書く以外の Write は行わない。** 出力先は `~/workspace/tasks/<slug>/plan.md` 固定。
- フロントマターで Bash/Edit はツール層ブロック済み。Read/Glob/Grep/Write/Agent/AskUserQuestion のみ使う。
- 承認が取れたらこのスキルは終了する。実装系の Agent は起動しない。

## フロー

### 1. タスクの理解と出力先決定

- 依頼を整理し、曖昧点があれば AskUserQuestion で 1〜2 件に絞って確認する。
- **同ディレクトリに `premise.md`（sear-me の成果物）があれば読み、その Goal / Scope / Open questions を step1 の確認結果として扱う。premise.md の Open questions に挙がっていない軸は再質問しない**（premise.md が無ければ従来通り 1〜2 問確認する＝疎結合維持）。
- **Open questions の引き継ぎ規約**: plan は premise.md の Open questions を step2 調査・step3 起草で解消し、**解消できなかったものだけ plan.md の Risks に繰り越す**（未決論点の二重所有を避ける）。
- タスクスラッグ（kebab-case 短語、例: `add-login-button`）を決める。
- 出力パス `~/workspace/tasks/<slug>/plan.md` をユーザに提示する。

### 2. 調査（read-only）

- Read/Glob/Grep で関係ファイル・既存実装を探す。
- 広範な調査が必要なら Agent (Explore) を最大 3 並列で起動する。
- 既存 utility/関数の再利用候補と、変更が必要なファイルを把握する。

### 3. 計画の起草

`~/workspace/tasks/<slug>/plan.md` を Write で作成する。構成:

- **Context**: 背景と目的（なぜこの変更が必要か）
- **Approach**: 推奨案のみ。代替案は載せない
- **Critical files**: 変更対象のファイル（パターンが繰り返されるなら 1 回説明＋代表パス数件）
- **Reusable utilities**: 再利用する既存実装（パス付き）
- **Verification**: 実行・テスト方法

### 3.5. 自己検証・レビュー（承認前）

承認をユーザに求める前に、plan.md を 2 種類の subagent で検証・レビューする。**ここで使うのは plan.md という文書に対応した専用 subagent であり、既存の `verify` / `code-review` スキル（diff・実行アプリ対象）とは別物。** 両スキルは plan フェーズでは入力を持たないので呼ばない。

#### 3.5-1. 2 つの subagent を並列起動（独立タスクなので並列）

- **検証 subagent**（事実の grounding／read-only）:
  - `subagent_type`: `Explore`
  - `prompt`: plan.md パスと**対象リポジトリのパス**を渡し「各事実主張を実コードと照合し、不一致だけを `{主張, 実態, 確認方法, 深刻度}` のリストで返せ。Critical files のパス実在、Reusable utilities の所在・シグネチャ、現状挙動の前提を重点的に。アプローチの良し悪しは判断するな。**plan.md の Approach／編集案に書かれた『変更後こうする』という文は未施行の提案であり、現状ファイルに無くて当然＝不一致ではない（これを事実誤りに数えない）。照合対象は『現状こうなっている』という現状認識の主張（Critical files のパス実在・Reusable utilities の所在/シグネチャ・現状挙動の前提）に限る**」
  - **「実在」「再利用可」の主張は statement 単位で、統合ブランチ（既定 `origin/master`）に対する確認手段に委ねる**——ツール選択は subagent の裁量（git でも他手段でもよい）。**失敗接地**: 同一リポジトリの未マージ worktree が複数並走するとき、作業ツリーや別ブランチの worktree を grep すると「統合ブランチに実在・再利用可」と誤断定し、実装着手時に当該シンボルが統合ブランチに無く詰む。skill 本体は Bash ブロックのため確認系コマンド（`git -C <repo> grep -n <symbol> origin/master` 等）はこの検証 subagent でしか叩けない＝委譲必須。確認手段の例示（`git -C <repo> grep ...` / `git -C <repo> ls-tree ...`）は失敗回避の参考であり、唯一の手段として規範化しない。
  - 各「再利用」主張には**現在どのブランチに在るか**（統合ブランチか、未マージの feature ブランチか）を実態に併記させる。未マージなら「先行マージ待ち」か「自前新設」かを Approach への反映候補として返させる。
- **レビュー subagent**（計画の妥当性／判断）:
  - `subagent_type`: `general-purpose`
  - `prompt`: plan.md パス＋元の依頼文＋（あれば）**前ラウンドの未解決論点リスト**を渡し、以下を全て満たすこと:
    - **指摘の数より質を優先せよ。各指摘は plan.md の特定の文・節に紐づき、改修可能なアクションに紐づくこと。指摘ゼロでも問題なければそれは正当な出力**。「観点 N 個ずつ何か言う」「観点ごとに 1 件以上」の網羅は不要。**失敗接地**: 観点を増やすほど指摘下限が機械的に上がる（観点インフレ）→ 同じ plan を 3 ラウンド回しても medium が減らない。観点を増やさない＝指摘下限を上げない。
    - **ラウンドごとに観点を絞る**: ラウンド 1 は計画全体の前提・Verification の十分性を重点に見る。ラウンド 2 以降は**前ラウンドで残った懸念だけに観点を絞り、新しい観点を持ち込まない**。前ラウンド指摘が `problem-none` に転じたかどうかを優先評価する。
    - **出力末尾に必ず ```` ```json ```` で始まる fenced block を 1 つ含めること**（自然言語 reasoning は block の前に書いてよい。最終判定は JSON block を真とし、自然言語と矛盾したら JSON 側に揃える）。これにより main の集計・比較を自然言語段落の解釈でなく field 読みに置換する。「指摘は番号付き項目で 1 件ずつ返す」要件は `findings[].id` を 1 から連番で振ることに置換する（`findings.length`＝母数で機械確定）。**`status=problem-none` の項目（supportive / 変更不要 / 観測前提の未決）も `findings` に必ず含めること**——「指摘事項」だけを列挙すると `findings.length`（母数）が縮み、観点インフレ予防の母数認定が崩れる。**失敗接地**: 旧版 prompt の「問題なし／supportive も独立番号を振る」要件が JSON 化で曖昧になると、subagent が supportive を吸収して「指摘事項」だけを返す経路が開く（母数を自己申告で絞る抜け穴）。**JSON block が複数出力された場合、出力末尾の block を真とする**——exemplar 引用などで複数 block が混在しても参照規約が一意に決まる。
    - JSON schema は以下の exemplar に従う:

      ```json
      {
        "round": 1,
        "findings": [
          {
            "id": 1,
            "summary": "Approach の節 X で Verification 手段が不足している",
            "status": "problem",
            "severity": "high",
            "subtype": null,
            "prev_round_ref": null,
            "quote": null
          },
          {
            "id": 2,
            "summary": "v1 観測前提の論点。観測してから決める方針が plan に明示されている",
            "status": "problem-none",
            "severity": null,
            "subtype": "deferred-by-design",
            "prev_round_ref": null,
            "quote": {"path": "~/workspace/tasks/<slug>/plan.md", "line": 45}
          }
        ],
        "totals": {
          "problem_high": 1,
          "problem_medium": 0,
          "problem_low": 0,
          "problem_none": 0,
          "deferred_by_design": 1,
          "count": 2
        }
      }
      ```

      各 field の意味:

      | field | 値 | 意味 |
      |---|---|---|
      | `round` | 整数 (1, 2, 3) | 何ラウンド目のレビューか |
      | `findings` | 配列 | 各指摘 1 件 1 要素。番号付き箇条書きの代替 |
      | `findings[].id` | 整数 (1, 2, 3, ...) | 連番。配列 index+1 と一致 |
      | `findings[].summary` | 文字列 | 指摘の自然言語要約 (1-2 文) |
      | `findings[].status` | `"problem"` / `"problem-none"` | 状態トークン |
      | `findings[].severity` | `"high"` / `"medium"` / `"low"` / null | `status=problem` のときのみ非 null |
      | `findings[].subtype` | `"deferred-by-design"` / null | `status=problem-none` のときのみ非 null |
      | `findings[].prev_round_ref` | `"new"` / `"carry-over"` / `"F<id>"` / null | ラウンド 2 以降のみ非 null（用途は下記参照） |
      | `findings[].quote` | `{path, line}` / null | `subtype=deferred-by-design` のときのみ非 null |
      | `totals.problem_high` | 整数 | `status=problem, severity=high` の件数 |
      | `totals.problem_medium` | 整数 | 同 medium |
      | `totals.problem_low` | 整数 | 同 low |
      | `totals.problem_none` | 整数 | `status=problem-none, subtype=null` の件数 |
      | `totals.deferred_by_design` | 整数 | `status=problem-none, subtype=deferred-by-design` の件数 |
      | `totals.count` | 整数 | findings 配列の要素数（= 全件数） |

    - **`status` / `severity` / `subtype` / `prev_round_ref` は固定 enum 値のみ。スキーマ表外の値を入れない**（field 値の予測可能性を担保）。
    - **各項目の状態トークン定義**（`findings[].status` / `findings[].severity` / `findings[].subtype` に encode する）:
      - `status=problem`: 改修が必要。さらに `severity` を `high` / `medium` / `low` の三段で併記する。
        - `severity=high` = **plan の Verification が不可能になる／スコープ外の再計画が必要／plan の前提を覆す事実誤り**。リトライおよび per-item ゲートの「前提を覆す」基準はこの severity:high を指す。ただし `Critical files` のパス実在・`Reusable utilities` の所在/シグネチャ等の repo level 事実誤りは検証 subagent (3.5-1 上段) の grounding 領分。レビュー subagent は plan の内部整合（前提と Verification が噛み合わない、Approach の依存関係矛盾 等）に範囲を限定し、repo を独自に grep しない（レビュー subagent には repo アクセス前提を入力していないため事実上独立検証は不能だが、明示しておく）。
        - `severity=medium` = 改修すべきだが Verification は通る範囲の不備。
        - `severity=low` = nice-to-have。
      - `status=problem-none`: 現状が plan の Verification・要件を既に満たし、当該提案は追加の luxury（あれば良いが必須でない）／観測前提の未決を「曖昧」と読み替えただけのもの。「supportive」もこちらに含める（`subtype=null`）。
      - `status=problem-none` のサブタイプ `subtype=deferred-by-design`: plan が learning loop 設計で v1 観測前提の未決を**故意に**残している論点。**この論点に対する唯一の対応は「観測してから決める」を plan に明文化すること**で、追加の決定や reword を要求しない。**失敗接地**: distill のような observe-driven 設計では v1 で未決を残すのが意図だが、レビュー側がそれを「曖昧 → medium」と読み替えて medium を量産する paradigm mismatch が起きた。`deferred-by-design` を明示することで「決め切らない」を「曖昧」と読み替える ambiguity を機構的に拒否する。**`subtype=deferred-by-design` を付ける場合、plan の本文に「v1 観測項目として未決を残す」「観測してから決める」等の明示的な observe-driven 宣言がある節を `findings[].quote.path` / `findings[].quote.line` で引用すること。引用できなければ `subtype=deferred-by-design` を付けてはならない**（`status=problem` または `status=problem-none, subtype=null` を付ける）。**失敗接地**: subagent 自己申告のみだと判断困難な medium を `deferred-by-design` に流す escape valve になりうるため、引用根拠を main 側で cross-check する設計にする（cross-check 本体は 3.5-3 直後の main 側手順を参照）。
    - **`findings[].prev_round_ref` の enum 値域と用途**:
      - `null`: ラウンド 1 のときの既定値（前ラウンドが無い）。
      - `"new"`: 今ラウンドで新たに立ち上がった懸念（前ラウンドに対応指摘が無い）。
      - `"carry-over"`: 前ラウンドから引き継いだが、特定の前ラウンド ID を辿らない汎用マーカー（同型の懸念が継続している場合等）。
      - `"F<id>"`: 前ラウンドで `status=problem` だった**特定の指摘 ID への明示参照**（例 `"F2"` は前ラウンドの `id=2` 指摘を指す）。3.5-3 step 5 (a) のラウンド間追跡（「対応済み」判定）はこの値で行う。
    - **`status=problem` だった前ラウンド指摘 ID が今ラウンドで `status=problem-none` に転じたと判断する場合は、必ず `prev_round_ref="F<id>"` で前ラウンドの該当 id を参照すること**（`carry-over` で済ませてはならない）。これにより main は step 5 (a) のラウンド間追跡で field 読みのみで「対応済み」を判定できる。**失敗接地**: F<id> 参照を任意にすると、subagent が carry-over で済ませた場合に main が「対応済み」を取りこぼし、観測上は「解消したのに対応済みに上がらない」状況になる。

#### 3.5-2. 結果の取り込み

- 検証で見つかった事実誤りのうち、**訂正に出典（`origin/master` 上の `path:line` / sha 等）を伴うものだけ** plan.md を Write で書き直して自動修正する（Edit はブロック済みなので全文 Write で上書き）。修正候補の出典 sample（path:line / sha / diff サマリ）は per-item 列挙（ステップ 4）に併記してユーザ視認可能にする（main で出典の正確性を直接検証する手段がないため、ユーザ目視を最後の砦にする）。
- **出典を示せない訂正は自動で書き換えず**、当該主張に「要確認」マークを残す。**失敗接地**: 出典なき自動修正は、誤った主張を別の同様に未確認な主張へ“それらしく”書き換えるだけで、結局どちらも統合ブランチに無いまま、という二重の誤り（ロンダリング）を生む。
- **レビュー指摘は plan.md に自動反映しない**（grounding の事実誤り訂正＝出典ありの自動修正とは別扱い）。改善したい指摘も含め、レビュー指摘で plan を勝手に書き換えず、ステップ 4 で全件「要判断」として提示する。例外は次の二経路のみ: **(a) 3.5-4 のリトライで前提を覆す指摘（severity:high）に対して plan を書き直し、再レビューで当該指摘 ID が `problem-none` に転じたことが確認されたもの**、**(b) 3.5-2 の出典付き自動修正で plan.md が書き直され、その変更が当該指摘を per-item に解消することが確認できるもの**。どちらも『対応済み』に置けるが、(a) は何ラウンド目のリトライで対応したか、(b) はどの出典付き訂正で解消したかを per-item に併記する。

#### 3.5-3. 件数保存則アサーション（恒等式の機械的検証）

レビュー subagent の出力を受け取った直後、main 側で以下を**明示ステップ**として実行する。**失敗接地**: 2026-06-09、5 論点を自動反映し要判断 0 で承認を取った（恒等式が破れたが事故時点では検出されなかった）。「破ったら露見する」設計でも、main にアサーションがなければ実際は露見しない。

1. レビュー subagent 出力末尾の ```` ```json ```` fenced block を Read で読み取る。**JSON block が複数出力された場合、出力末尾の block を真とする**（exemplar 引用などで複数 block が混在しても参照規約が一意に決まる。3.5-1 下段 prompt と同一規約）。`findings` 配列の要素数を field 読みで確定する＝これが生指摘件数（`findings.length`）。JSON block が出力に無い／schema 逸脱で主要 field が読めない場合、レビュー subagent を**一度だけ**再実行して取り直す。再実行しても読めなければ、main では項目を切らず**自然言語段落の全行を独立項目として保守的に最大数で数える（少なく丸めない）**。
2. `totals.count == findings.length` の自己整合を field 読みで確認する。次に `totals.problem_high + totals.problem_medium + totals.problem_low + totals.problem_none + totals.deferred_by_design == totals.count` の恒等式を field 値の加算で確認する（grounding＝検証 subagent の事実誤り訂正は別系統で恒等式に含めない）。
3. 上記いずれかの恒等式が成立しなければ、**レビュー subagent をもう一度実行して取り直す**（再実行は最大 1 回）。それでも不成立なら、状態未定の項目は保守的に「要判断」に倒してから per-item 列挙に進む。
4. **`deferred-by-design` の引用 cross-check**: `findings[].subtype == "deferred-by-design"` が付いた項目について、`findings[].quote.path` / `findings[].quote.line` で参照された plan の observe-driven 宣言が現実に plan.md に存在するかを Read で確認する。引用が見当たらない／plan に observe-driven 宣言が無いのに `subtype=deferred-by-design` が付いている項目は、状態を `要判断` に倒して per-item 列挙へ進む（subagent の分類を main で上書きする。escape valve 化を予防する main 側の砦）。
5. 4 状態への振り分け（対応済み・要判断・対応不要・保留-設計上意図）は `status` / `subtype` / `prev_round_ref` を field 読みで判定する。**以下の priority 順で上から評価し、最初にマッチした状態に振り分ける（排他化）**——例: 前ラウンド `status=problem` だった指摘が今ラウンド `status=problem-none, subtype=null, prev_round_ref="F<id>"` に転じた項目は (a) と「対応不要」の両方に形式上当てはまるが、priority 順で先に評価される (a) に倒れる:
   1. **「対応済み」(a)**: ラウンド 2 以降で、前ラウンド `status=problem` だった指摘 ID を今ラウンドの `prev_round_ref="F<id>"` で参照し、当該項目が `status=problem-none` に転じたもの。
   2. **「対応済み」(b)**: 3.5-2 の出典付き自動修正の**直後に走る 3.5-5 再レビュー**で `status=problem-none` に転じた項目。**この判定は field 読みのみでは決定できない**ため、main は 3.5-2 で plan を書き直した際の「どの自動修正 → どの per-item 指摘に対応するか」の対応関係を context に保持し、3.5-5 再レビュー結果と突き合わせて (b) を認定する。ラウンド 1 の 3.5-5 では `prev_round_ref` が null のため、(b) と「対応不要」の区別はこの main 側 context 突き合わせでのみ可能。per-item に「(b) どの出典付き訂正で解消」根拠を併記する規約（ステップ 4 の line 「(b) 3.5-2 の出典付き自動修正…」）は、この main 側 context を根拠にする。
   3. **「保留-設計上意図」**: `status=problem-none, subtype=deferred-by-design`（step 4 の cross-check を通過したものに限る）。
   4. **「対応不要」**: `status=problem-none, subtype=null` で上記いずれにも該当しないもの（メインが解釈で要判断から振り分けない）。
   5. **「要判断」**: 上記いずれにも該当しないもの。

このアサーションを省略してはいけない。

#### 3.5-4. リトライ（質的減少で停止）

リトライの停止判定は「**指摘の質的減少**」（主則）と「**ハードリミット 2 回**」（保険）の 2 段構え。質的減少が満たされなくなった時点で停止し、それより前にハードリミットに当たれば暴走防止として強制停止する。背景: 履歴メタ（再実行ログの有無）でなく、対象（指摘の質的解消）でリトライ効果を測ることで、儀式化されたリトライ（ログだけあって質的に減っていない）を防ぐ。

- リトライ実行の条件: `curr.totals.problem_high > 0`（= 前提を覆す指摘が残っている）。`problem_high == 0` で `problem_medium` / `problem_low` だけならリトライせず、ステップ 4 の per-item ゲートに合流させる。
- リトライ後は、変更された plan.md に対して**残懸念のみ**で再レビューを回す（観点を絞る運用＝ステップ 3.5-1 の prompt で前ラウンド未解決論点リストを渡す）。
- **質的減少の判定**: 前ラウンドと今ラウンドの JSON block を両方 Read（main context に保持された前ラウンド出力を参照）し、以下を比較する:
  - 前ラウンドで `status=problem` だった指摘 ID のうち、今ラウンドで `prev_round_ref="F<id>"` 参照付きで `status=problem-none` に転じたもの＝「対応済み」候補。
  - 以下の**両方**を満たすときに「質的減少した」と判定する（AND・どちらも JSON field 値の不等式で判定）:
    - **(a) severity:high の件数が前ラウンドより厳密減少**: `prev.totals.problem_high > curr.totals.problem_high`（0 でも前ラウンドより減っていれば可）。
    - **(b) `problem` 件数の合計が前ラウンドより非増加**: `prev.totals.problem_high + prev.totals.problem_medium + prev.totals.problem_low >= curr.totals.problem_high + curr.totals.problem_medium + curr.totals.problem_low`（同数または減少。前ラウンドより増加していたら停止）。
  - どちらかを満たさなければ、リトライしても効果が無いと判定し**停止する**（例: `problem_high` 1→0 だが `problem_medium` 3→5 のケースは (a) 達成・(b) 不達成で停止に倒れる）。
- 停止後、未解決の論点は per-item 列挙に「要判断」または「保留-設計上意図」状態で合流させる（別経路で添えず、列挙を単一の出口にする）。
- **ハードリミット（暴走防止の保険・主則ではない）**: リトライは最大 2 回まで。観点を絞る運用（3.5-1）が機能していれば、回数を増やしても観点インフレは起きない設計だが、暴走防止としてハードリミットも残す。**失敗接地**: 旧設計の「最大 1 回」は履歴メタで打ち止める設計だったため、実装上は 1 ラウンドで承認に直行する儀式化が起きた。質的減少で停止に置き換えると、回数を保険にできる。

#### 3.5-5. 修正起点の二次整合チェック

出典付き自動修正（3.5-2 で plan.md を書き直したケース）が発生した場合、修正によって新しい縁が湧くことがある（修正起点で新指摘が立つ現象）。**3.5-1 の観点を絞る運用と 3.5-4 の質的減少停止の延長として、1 回だけ**残懸念観点での再レビューを通す。3.5-5 自体は 1 回上限。

新指摘が立った場合の制御フロー:

- **severity:high の新指摘が立った場合**: 3.5-4 のリトライ枠に戻し、リトライ回数として **1 回カウントする**。3.5-4 のハードリミット 2 回が支配する（暴走防止）。「リトライ回数にカウントしない」のは**新指摘が立たずにそのまま per-item へ進む場合に限定**する。
- **severity:medium / low / problem-none のみ**: 当該新指摘を**今ラウンドの生指摘集合に追記**して per-item 列挙へ進む（severity:high が無いのでリトライ自体は発火しない）。
- **新指摘が立たなければ**: そのまま per-item 列挙へ進む（この経路だけがリトライ回数にカウントされない。事実訂正起因の二次整合チェックであり、計画妥当性のリトライとは別軸）。

母数の合算規則: 3.5-5 で立った新指摘 K 件は、前ラウンド集計の「対応済み」n 件・「対応不要」m 件を母数から外した残懸念に追加する形で 1 つの per-item リストにまとめ、件数保存則（3.5-3）の母数は **「残懸念 + K」** とする（前ラウンドで処理済みの項目は今ラウンド母数から外す。3.5-3 の恒等式は新しい母数で再アサートする）。

ループ防御の整理: 3.5-5 自体は 1 回上限。3.5-5 で severity:high が出て 3.5-4 に戻したらリトライ回数として加算され、3.5-4 ハードリミット 2 回が支配する。

### 4. 承認

- plan.md のパスを示し、ステップ 3.5 のサマリと**レビュー指摘の per-item 判断ゲート**を添えて承認可否を取る。**per-item 列挙は本文で行い、AskUserQuestion は採否入力（4 件以下）または反映後の最終承認に使う（提示と承認を同一 AskUserQuestion に押し込まない）**。
- **検証のサマリ**: 「検証で N 件修正・**要確認 J 件**（出典が出せず自動修正を保留した主張）」。出典付き自動修正があった場合、修正候補の sample（path:line / sha / diff サマリ）を per-item に併記してユーザが目視で正確性を確認できるようにする。
- **レビュー指摘の per-item 提示（判断ゲート）**: レビュー subagent が返した生の指摘を、**要約・取捨・マージせず1件ずつ番号付きで `{論点／深刻度（severity:high|medium|low）／状態（対応済み｜要判断｜対応不要｜保留-設計上意図）／反映するなら plan のどこを何に変えるか}` を列挙**し、ユーザに per-item で採否を答えさせる。各指摘の**状態**は四択。
  - **「対応済み」**: 以下のいずれか（OR）に該当するもの限定:
    - **(a) 3.5-4 のリトライで前ラウンド `problem` 指摘 ID が `problem-none` に転じたことが確認されたもの**。per-item に「(a) ラウンドN で対応」と根拠を併記する（前ラウンド指摘 ID と何ラウンド目のリトライで対応したか）。
    - **(b) 3.5-2 の出典付き自動修正で plan.md が書き直され、その変更が当該指摘を解消することが per-item 列挙で確認できるもの**。per-item に「(b) どの出典付き訂正で解消」と根拠を併記する（出典 sample の path:line / sha 等）。
    - 旧設計の「3.5-4 リトライで problem→problem-none 転換確認」AND「Step 3 書き直しで取り込み」の AND 条件を OR に緩和した経緯: medium 指摘で plan 書き直ししても（severity:high が無いのでリトライ非発火）「対応済み」に上がる経路が無く、severity:high のみが「対応済み」へ昇格できる非対称が生じていた。OR への緩和でこの経路を開ける（(b) 経路は 3.5-2 の出典付き訂正に限定し、出典なき自動修正で「対応済み」に昇格させる経路はそのまま塞ぐ）。
  - **「対応不要」**: レビュー subagent が状態トークン `problem-none` を付け、かつ `deferred-by-design` でない項目に一致するもの限定（メインが解釈で要判断から振り分けない）。
  - **「保留-設計上意図」**: レビュー subagent が `problem-none` のサブタイプ `deferred-by-design` を付けた項目。plan 側で「v1 観測項目」として明示する以外の追加対応を求めない（要判断と混ぜない）。
  - **「要判断」**: 上記いずれにも該当しないもの全て。
  - 四択いずれも列挙の手前で消さず per-item に出す。
  - **件数保存則（母数の認定を自己申告から外す要石）**: 本則（恒等式・母数の数え方・再実行ポリシー）は **3.5-3 で定義済み**——ステップ 4 ではその結果として確定した四つの件数（対応済み・要判断・対応不要・保留-設計上意図）を per-item 列挙の前に明示し、合計が生指摘件数に一致することを示す（恒等式詳細・番号付け規約・再実行ポリシーは 3.5-3 を参照）。運用ルールとして、**「対応不要」はレビュー subagent が `problem-none` を付け、かつ `deferred-by-design` でない項目に限る**（メインが解釈で要判断から振り分けない）。**要判断 0 は、生出力が 0 件か、全件が「対応済み」「対応不要」「保留-設計上意図」に振れたときだけ恒等式上で成立**する。自己申告で母数を絞る／「対応済み・対応不要・保留-設計上意図」に畳んで要判断を減らせば恒等式が破れて露見する。
  - **採否入力の手段**: 4 件以下なら AskUserQuestion の multiSelect『採用する指摘を選択』でもよい。**5 件以上は本文に全件列挙し、番号指定で per-item に採否を答えさせる（multiSelect は使わない）**。いずれも **multiSelect は採否入力の手段にすぎず、全指摘の列挙は常に本文で行う**＝選択肢からの除外で指摘を落とさない。
  - 採否が決まった指摘だけを承認後に plan へ反映する。「保留-設計上意図」の項目は、採否でなく**「v1 観測項目として plan に明示する」ことが対応**——承認後に plan の該当節へ「v1 では観測後に決定する」旨を追記して終わる（reword 不要・要判断と混ぜない）。
- 承認後はスキル終了。呼び出し元（main セッションまたは /develop）に plan.md のパスを返す。

## やってはいけないこと

- plan.md 以外を Write する
- 承認後に自分で実装に進む（subagent 起動含む）
- 検証・レビュー subagent に実装やコード変更をさせる（どちらも read-only。検証は Explore、レビューは批評のみ）
- plan フェーズで `verify` / `code-review` スキルを呼ぶ（diff・実行アプリが無いので機能しない。実装後に呼び出し元が回す責務）
- 出力先を `.claude/plans/` にする
- EnterPlanMode を呼ぶ（このスキルは plan モードを使わない設計）
- レビュー指摘を（3.5-2 の出典付き自動修正、または 3.5-4 のリトライで `problem-none` に転じたことを確認した書き直し以外で）plan.md に自動反映し、**母数を絞る／「対応済み・対応不要・保留-設計上意図」に畳んで**要判断を 0 件にして単一承認で済ませる（判断ゲートの消失。失敗接地: 2026-06-09、5論点を自動反映し要判断0で承認を取った。母数絞り・状態畳みは予防的封じ。3.5-2／3.5-3／ステップ4 の per-item ゲート・件数保存則参照）
- レビュー subagent の生出力を要約・取捨・マージして件数を減らしてから提示する（指摘を列挙の手前で消す＝ゲートの迂回。生の N 件＝提示の N 件）
- ステップ 3.5-3 の件数保存則アサーションを省略して、レビュー subagent の出力をそのままステップ 4 に流す（恒等式不成立が露見しなくなる。失敗接地: 「破ったら露見する」設計でも main にアサーションがなければ実際は露見しなかった＝2026-06-09 事故）
- レビュー subagent prompt から JSON 出力形式（fenced ```` ```json ```` block）を省略して自然言語のみで返させる（main の集計が自然言語段落の解釈に戻り、解釈裁量が再混入する。3.5-3 / 3.5-4 が JSON field 読みを前提に書かれているため、JSON 省略は機構全体を旧設計に巻き戻す）
- レビュー subagent prompt に「観点 N 個」「観点ごとに 1 件以上」の網羅指示を入れ、観点を増やすほど指摘下限が機械的に上がる prompt design にする（観点インフレ。失敗接地: 同じ plan を 3 ラウンド回しても medium が減らない正のフィードバックループを引き起こす）
- `deferred-by-design`（learning loop で v1 観測前提に故意に未決を残した論点）を「要判断」に統合して per-item の質問数を増やす（observe-driven 設計を ambiguity と読み替える paradigm mismatch を再生産する。`deferred-by-design` は「v1 観測項目として plan に明示する」が唯一の対応で、追加決定を求めない）
- subagent が引用無しで `deferred-by-design` を付け、main がそれを検証せずに per-item で「保留-設計上意図」として通す（escape valve の経路。失敗接地: subagent 自己申告のみだと判断困難な medium を `deferred-by-design` に流す escape valve になりうる。main 側 cross-check は 3.5-3 step 4 で必須化済み）
- リトライ続行/停止を「履歴メタ（再実行ログの有無）」で判定する（儀式化を再生産する。リトライは指摘の質的減少＝前ラウンド `problem` が `problem-none` に転じた件数または severity 構成の改善で測る）
