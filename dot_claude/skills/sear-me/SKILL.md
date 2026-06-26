---
name: sear-me
description: 計画に入る前に、**目的（Purpose / Why）と受入条件（Acceptance / Done）**を中心に、隠れた前提・スコープ境界・未決事項を素早く炙り出して <現在の作業スペース>/premise.md に確定するスキル。draft-first 構成——まず premise.md の draft を書いて自己充足の仮定を可視化し、draft に残った分岐点だけを最大 2 ラウンドで質問して status: final に確定する。成果物は premise.md（status: final が plan への引き渡し条件・plan の目的整合レビューの正本になる）。grill-me の軽量版（炙る＝表面だけ素早く）で、芯まで焼く徹底尋問はしない。「前提を整理して」「計画前に炙り出して」「要件を固めて」「目的と受入条件を出して」などの依頼で起動する。
---

# sear-me: 前提を炙り出すフェーズ（plan の前段）

依頼を read-only で最小限調べ、まず premise.md の **draft を書き**、draft に残った分岐点だけをユーザに質問し、回答を反映した確定版（`status: final`）を書いて終了するスキル。**plan の目的（Purpose）と受入条件（Acceptance）の正本**を確定するのが役目で、自分で計画・設計は立てず実装にも進まない（plan・implement の責務）。

plan との分担（改修後の plan スキルと整合）:

- sear-me が確定: **Purpose（目的・Why）** と **Acceptance（受入条件・Done）**。plan はこの 2 軸を再定義せず参照する。
- plan が担う: **設計（Design）** と **計画（Phase 分割）**。sear-me は設計・段取りに踏み込まない。
- plan の目的整合レビューは premise.md の Purpose / Acceptance を逐語参照して plan との対応を見る（plan SKILL.md 側に encode）。

「炙る（sear）」＝表面だけ素早く火を入れる。芯まで焼く `grill-me` の軽量版。軽さは質問数を縛って作るのではなく構造で作る——自分で埋められる前提は draft に埋まった状態で可視化されるので、質問は「draft のこの仮定で良いか」という具体物への確認に縮む。

## 実行モデル

- **Write は 現在の作業スペース のみ**（draft と確定版の 2 回が基本形）。他のファイルは書かない。
- 使うツールは Read/Glob/Grep/Write/AskUserQuestion のみ。Bash/Edit/Agent は使わない。この制約をフロントマターの `disallowed-tools` に**置かない**——`Skill` tool は main で動くため、スキルが active な間呼び出し元まで巻き添えでツールを失う（失敗接地: 2026-06-11、plan スキルで確認済みの構造）。

## フロー

### 1. 最小調査（read-only・無質問）

- 依頼文を整理し、draft を書くのに必要な最小限の調査だけを Read/Glob/Grep で行う。網羅的なファイル洗い出しはしない（plan 側の調査工程の責務）。
- 調査と依頼文から自分で埋められる前提はすべて埋める。ただし**ユーザに明示確認していない判断は、次ステップで Assumptions に仮定として記録する**——黙って決めるのではなく、決めた内容を事後 veto できる形にする。
- **XY problem 判定**: 依頼が手段指定の形か（「X を使って」「Y で実装して」など、解き方を名指しした依頼か）をここで判定する。該当したら step 3 の必須設問になる。

### 2. draft を Write（status: draft）

- タスクディレクトリ名は 作業スペース の命名規則に従う（内容が一目で分かる日本語名。既存の plan.md があるディレクトリなら同居させる）。
- 下記「premise.md の構成」の全軸を埋め、`status: draft` で Write する。
- 書きながら、質問に値する分岐を抽出する。基準は **decision-changing test**: 答えがどちらでも plan が変わらない質問は捨てる。残った分岐だけが質問になる。
- 質問の数はタスクの stakes で較正する: 影響範囲が小さく可逆なタスクは 0〜2 問で十分。上限まで使うのは不可逆・影響大の分岐があるときだけ。
- 分岐がゼロなら質問せず step 5 に直行してよい（0 問パス。Assumptions が事後 veto の面として残るので、聞かずに確定しても安全）。

### 3. Round 1（AskUserQuestion 1 回・最大 4 問）

- 各設問は draft の具体箇所に錨付けする（「draft は A と仮定したが良いか」の形）。draft と独立な抽象的要件質問にしない。
- 選択肢は推奨案を先頭（(Recommended) 付き）に置き、**各選択肢の description に「選ぶと何が変わるか・何を捨てるか」を書く**。判断材料がラベルだけの選択肢を出さない。
- step 1 で手段指定と判定した依頼では、「そもそも何を解きたいか／別アプローチの要否」を必須設問として含める。

### 4. Round 2（任意・最大 4 問）

- Round 1 の回答が新たな分岐を開いたときのみ実施する。**ここでハードストップ**——3 ラウンド目には入らず、残った曖昧さは Open questions に書いて plan に引き継ぐ。

### 5. 確定版を Write（status: final）

- 回答を反映して全文を書き直し、`status: final` で Write する。聞いた質問・選ばれた回答・その含意は Decisions に記録する。回答で解消した Assumptions は削除するか Decisions へ昇格させる。
- frontmatter の `open_questions` を残存件数に更新する。
- premise.md のパスと、自己充足した仮定（Assumptions）の要点を報告して終了する。plan は同ディレクトリの premise.md を自動で検出して読む（口頭引き継ぎ不要）。

## premise.md の構成

frontmatter:

```yaml
---
status: draft   # 確定したら final に反転する。final 以外を plan は受け付けない（契約）
open_questions: 2   # Open questions / Risks の未決論点の件数
---
```

### コア軸（必須）

- **Request**: 依頼の一文要約（言い直し）。
- **Purpose (目的・Why)**: なぜこれをやるのか（上流の目的）。plan の Context・目的整合レビューの入力。「何が困っていて」「何を達成したいか」を 1〜3 行で書く。手段の名指しで埋めない（手段は Scope: In 側）。
- **Acceptance (受入条件・Done)**: 観測可能な完了条件。テスト・確認手段・運用上の判定基準に落とせる粒度で書く（「動く」ではなく「X が Y を満たして観測できる」）。plan の Verification 節・Phase 別受入の入力になる。複数あれば箇条書き。
- **Scope: In / Out**: やる・やらないの線引き。**Out を最低 1 つは引き出す**（暗黙の過剰要求の除去。plan の YAGNI レビュー観点と接続）。
- **Assumptions**: 明示確認せず自己充足した仮定の列挙。0 問パスの事後 veto 面なので、「なし」と書けるのは本当に仮定を置かなかったときだけ。
- **Open questions / Risks**: plan が解くべき未決論点。**手段指定依頼なら「真の課題への正しい解か（代替アプローチの検討要否）」を必ず含める**（step 1 の判定と連動）。

### 該当時のみ（無ければ省略）

- **Decisions**: 質問→回答→含意のトレース（質問した場合は必須）。plan が「なぜこのスコープか」を遡る根拠になる。
- **Constraints**: 技術・互換・時間・譲れない点。
- **Known context**: 質問・仮定の前提になった調査範囲だけ（パス付き）。網羅調査ではない（plan 側の責務を侵食しない）。

## plan との契約

- plan は step 1 で同ディレクトリの premise.md を検出して読む（plan SKILL.md 側に記載）。
- **Purpose / Acceptance は premise.md が正本**。plan は再定義しない（plan の Context は premise の Purpose を踏まえる・plan の Verification と Phase 別受入は premise の Acceptance を辿れる粒度で書かれる）。plan のレビューにおける目的整合観点は、premise.md の Purpose / Acceptance と plan の Context / Verification / Phase の対応を見る（plan-pipeline.js に encode 済み）。
- `status: draft` のまま終了しない。中断等でやむを得ず draft 止まりになった場合、plan 側は未確定として扱い、続行可否をユーザに確認する。
- Open questions は plan 側で解消を試み、解消できなかったものだけ plan.md の Risks に繰り越される（未決論点の二重所有を避ける。plan 側規約）。
- **設計（Design）と計画（Phase 分割）は plan の領分**。premise.md でデータ構造・責務分割・実装手順に踏み込まない（踏み込むと sear-me が grill-me 寄りに肥大し、plan の設計レビュー対象が premise 側に流出する）。
