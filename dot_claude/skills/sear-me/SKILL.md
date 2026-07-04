---
name: sear-me
description: 計画に入る前に、依頼の課題や曖昧な点を炙り出し、**目的（Purpose / Why）と受入条件（Acceptance / Done）**を plan がそのまま使える精度にして <現在の作業スペース>/premise.md に確定するスキル。設計・Phase 分け・具体的な変更箇所は plan の領分で踏み込まない。「前提を整理して」「計画前に炙り出して」「要件を固めて」「目的と受入条件を出して」などの依頼で起動する。
---

# sear-me: 前提を炙り出すフェーズ（plan の前段）

依頼を調べ、まず premise.md の draft を自力で埋め、残った分岐だけをユーザに 1 問ずつ聞き、Purpose / Acceptance が「final の条件」を満たしたら `status: final` で確定して plan に渡すスキル。自分で計画・設計は立てず実装にも進まない（plan・implement の責務）。

元ネタは mattpocock/skills の grilling（全設計分岐を執拗に尋問して shared understanding に達する）。sear-me は尋問の**範囲**を Purpose / Acceptance / 前提に絞ることで軽くする。軽くするのは範囲だけで、原典の 3 原則はそのまま保つ:

1. **質問は 1 問ずつ、依存順に。** 回答を読んでから次の質問を決める。複数質問の同時出しは相手を混乱させ、ゲート設問（答えが他の設問の前提を変える質問）と従属設問を同時に出すと片方が無駄になる（失敗接地: 2026-07-02 vault-catalog 実走。要否見直しのゲートと鮮度要求を同時に出し、ゲートの回答で後者が moot 化した）。
2. **調べれば分かることは聞かない。** premise の記述を左右する事実は Grep/Read で自分で確認する。plan と分けるのは設計判断・網羅的影響調査・手順化であって、読解の量ではない（失敗接地: 2026-07-02 vault-catalog 実走。Grep 一発で確定する参照有無を確認せず、Acceptance の条件分岐として plan に先送りした）。
3. **終了は認識的条件で決める（step 3「final の条件」）。** 質問数・ラウンド数の消化を final の根拠にしない（失敗接地: LLM Wiki 純関数化の実走。設問がスコープ・事務の追認のまま final を宣言し、真の Purpose＝コスト・スケールが事後にユーザから出て final を 3 回宣言し直し、手動差し戻しになった）。

plan との分担:

- sear-me が確定: **Purpose（目的・Why）** と **Acceptance（受入条件・Done）**。plan はこの 2 軸を再定義せず参照する。
- plan が担う: **設計（Design）・計画（Phase 分割）・Scope: In**。sear-me は踏み込まない。
- 調査・対話で設計材料が判明してしまったら、捨てずに premise の「plan への申し送り」節へ隔離する。禁止だけを置くと行き場の無い情報が他の節に滲む（失敗接地: 実走で Assumptions に tool シグネチャ・Dockerfile 構成まで書き下ろした premise が生成された）。

## 実行モデル

- **Write は `<現在の作業スペース>/premise.md` のみ**（draft と final の全文 Write。細切れの Edit で継ぎ足さない）。Write は親ディレクトリを自動生成するので mkdir は不要。
- 調査は Read/Glob/Grep を基本とし、Edit・Agent・状態を変える Bash は使わない。この制約をフロントマターの `disallowed-tools` に**置かない**——`Skill` tool は main で動くため、スキルが active な間呼び出し元まで巻き添えでツールを失う（失敗接地: 2026-06-11、plan スキルで確認済みの構造）。

## フロー

### 1. 調査して draft を書く

- 依頼文を整理し、premise の記述を左右する事実を Read/Glob/Grep で確認する。調査の境界は量でなく判断で引く——Purpose / Acceptance / 前提の記述に効く事実（参照の有無・設定の実在・現行挙動）は自分で確認する。設計判断のための調査（実装方式の比較・影響範囲の網羅）は plan の領分。
- 手段指定の依頼（「X を使って」「Y 化したい」）では、Purpose を手段の名前を使わずに書けるか試す（XY レンズ）。書けなければ、それが最初の質問候補になる。手段が上流の決定で確定済みなら、その旨と根拠を Decisions に 1 行残す（黙った省略と正当な省略を後から区別できるようにする）。
- 自分で埋められる前提はすべて埋める。ユーザに明示確認していない判断は Assumptions に記録する（黙って決めるのではなく、事後 veto できる形にする）。
- タスクディレクトリ名は 作業スペース の命名規則に従う（内容が一目で分かる日本語名）。**呼び出し元（/develop 等）からディレクトリ指定があれば命名規則より優先する**。同ディレクトリに premise.md が既にあれば Read し、既存の Decisions / Assumptions を新 draft に引き継ぐ（全文上書きで消さない）。
- `status: draft` で Write する。

### 2. 質問する（1 問ずつ・残差のみ）

- 聞くのは自力で解消できない分岐だけ——ユーザの意図・優先度・許容水準・トレードオフの選好。基準は **decision-changing test**: 答えがどちらでも plan が変わらない質問は捨てる。**質問ゼロは正当な結果**（分岐が無ければ聞かずに step 3 へ。Assumptions が事後 veto の面として残る）。設問ノルマは無い——規則を満たすための質問を作らない。
- **AskUserQuestion 1 回に 1 問。** 回答を読んでから次の質問を決める。ゲート設問は必ず単独で先に出す。
- 設問は draft の具体箇所に錨付けする（「draft は A と仮定したが良いか」の形）。ただし **Purpose を問うときは枠外の答えを許す**——閉じた選択肢はモデルの仮説の追認装置になりやすく、真の動機が全選択肢の外にあった実走例がある。「どれでもない場合は自由記述で」と設問文に明示する。
- 推奨案を先頭（(Recommended) 付き）に置き、各選択肢の description に「選ぶと何が変わるか・何を捨てるか」を書く。選択肢オブジェクトは label と description のみで構成する（preview 等の任意キーを null で付けない。失敗接地: 2026-07-02、preview: null で InputValidationError の 1 往復空費）。
- safety（中量級の上限）: 質問が 5 問を超えて続きそうなら、残りの分岐を Open questions に整理して提示し、続けるか plan に引き継ぐかをユーザに諮る。ここで黙って final にしない。
- **タイムアウトは回答ではない。** AskUserQuestion が 60 秒タイムアウト（「No response — proceed using your best judgment」）を返しても、仮定で埋めて先に進まない——質問した時点で「ユーザにしか決められない」と判定済みの分岐であり、best judgment の適用対象がそもそも無い。質問を地の文で再掲してターンを終え、回答を待つ（地の文で終えたターンはタイムアウトせず、次の入力まで無期限に待てる）。セッションがそこで閉じるなら draft のまま、残った質問を添えて報告する（失敗接地: 2026-07-02、保証水準の設問タイムアウトをエコシステム規約ベースの仮定で自己解決して final を宣言し、ユーザ指摘で draft に差し戻した）。

### 3. final を確定する（認識的条件）

final を名乗れる条件。**すべて満たすまで final にしない**（満たせない事情で中断するなら draft のまま、何が不足かを添えて報告する）:

- Purpose が手段の名前を使わず 1〜3 行で書けている。
- Acceptance の各項が観測可能で、**無条件**に書けている——「〜が判明したら差し戻し」のような条件分岐を含まない。条件分岐が残るのは、確認できる事実が未確認（原則 2 に戻って調べる）か、分岐がユーザ未決（step 2 に戻って聞く）かのどちらか。
- 残る未決が「ユーザにしか決められないこと」か「plan が解く設計判断」だけで、Open questions / Risks に明記されている。
- 質問した場合、Decisions に質問→回答→含意が記録されている。回答で解消した Assumptions は削除するか Decisions へ昇格済み。

満たしたら全文を書き直して `status: final` で Write し、premise.md の**フルパス**と、Purpose / Acceptance の要約・Assumptions の要点を報告して終了する。

## premise.md の構成

frontmatter は `status: draft | final` のみ。open_questions 件数フィールドは置かない（自己申告カウントは本文と乖離した実績があり、plan は本文の Open questions 節を読む）。

### Primary（必須）

- **Request**: 依頼の一文要約（言い直し）。
- **Purpose (目的・Why)**: 何が困っていて何を達成したいか（上流の目的）。手段の名指しで埋めない。plan の Context・目的整合レビューの入力。
- **Acceptance (受入条件・Done)**: 観測可能な完了条件。「動く」ではなく「X が Y を満たして観測できる」の粒度。plan の Verification 節・Phase 別受入の入力。

### Secondary（該当時のみ・無ければ節ごと省略）

- **Non-goals**: Purpose 由来で明示的に除外するもの。あれば書く。件数ノルマは無い（ノルマは埋め草の捏造を生み、plan の YAGNI レビューの入力を汚す）。
- **Assumptions**: 明示確認せず自己充足した仮定の列挙。0 問で final にする場合の事後 veto 面。
- **Open questions / Risks**: plan が解くべき未決論点。
- **Decisions**: 質問→回答→含意のトレース（質問した場合は必須）。XY レンズの判定結果（発火したか・上流確定済みで省いたかと根拠）もここに 1 行。
- **plan への申し送り**: 調査・対話で判明した設計材料・Scope 寄りの情報の行き先。plan は Approach / Design の参照入力として読む（Purpose / Acceptance と違い正本ではない——plan が別の設計を選んでよい）。
- **Constraints / Known context**: 技術・互換・時間の制約と、質問・仮定の前提になった調査範囲（パス付き）。

**深さの天井**: 決定軸（分岐そのもの・選択の理由）は記録するが、関数シグネチャ・設定ファイルの中身・実装手順は書かない。書きたくなったら「plan への申し送り」に 1 行で。

## plan との契約

- 引き渡しの主経路は **premise.md のフルパスの明示渡し**（step 3 の報告に含め、plan 起動時に `premise_path` として渡る）。同一セッションの連続実行では plan が同ディレクトリの premise.md を自動検出する（フォールバック）。
- **Purpose / Acceptance は premise.md が正本**。plan は再定義しない（plan-pipeline の目的整合レビューが premise と plan の対応を見る。plan-pipeline.js に encode 済み）。
- `status: final` 以外は未確定扱い。plan は draft の premise を足場にせず、続行可否（draft のまま進める／sear-me をやり直す）をユーザに確認する。
- Open questions は plan 側で解消を試み、解消できなかったものだけ plan.md の Risks に繰り越す（未決論点の二重所有を避ける。plan 側規約）。
- 「plan への申し送り」は plan の参照入力であって正本ではない。

## やってはいけないこと

- premise.md 以外を Write する。
- 依存関係のある設問を同時に出す（ゲート設問は単独で先に。原則 1）。
- 調べれば確定する事実をユーザに質問する、または Acceptance の条件分岐として plan に先送りする（原則 2）。
- 質問数・ラウンド数の消化を final の根拠にする（final は step 3 の認識的条件で決める。原則 3）。
- 設問ノルマ・Non-goals ノルマを満たすための埋め草を作る（ゼロは正当な出力）。
- 設計・実装に踏み込む（データ構造・責務分割・実装手順・Scope: In の線引きは plan/implement の領分。判明済みの設計材料は「plan への申し送り」へ隔離する）。
- skill フロントマターに `disallowed-tools` を置く（main 巻き添えの構造。失敗接地: 2026-06-11）。
