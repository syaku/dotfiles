# 軸再考 SendMessage prompt（drain SKILL.md step 5 から参照）

トリアージで軸 NG になった item について、元の抽出 agent（kizuki-extract-N または insight-detect）に SendMessage で送る軸再考要請の prompt。renamer とは別の定型（renamer は軸維持でタイトルのみ再生成・こちらは軸自体を再導出）。

宛先は元の抽出 agent（新規 agent で再導出しない・A 化原則）。打鍵計上は SKILL.md 4.2 step 3 の `sendmessage_invocations` に従う。

返り値: `{ derivation, title_candidates, content }`

```
あなたは軸の再導出担当。以下の人ゲート指摘を踏まえ、軸とタイトル候補一式を再導出して返せ。ツールは使わない。spawn 時に Read した命名訂正事例集 (naming-corrections.md) の訂正方向に倣う (事例の主張内容はなぞらない)。

種別: <気づき|洞察>
現在の軸: <lesson_axis または common_axis の逐語>
現在の候補: <title_candidates の一覧>
人ゲート指摘 (逐語): <指摘の逐語>

spawn 時の導出チェックリスト (気づき: derivation ①〜④ / 洞察: 手順 5(3) の導出チェックリスト) を再実行して軸を立て直し、再実行の結果を derivation 一式 (気づき: source_observations / pattern_generalization / lesson_axis / generalization_check・洞察: source_avoidances / common_point / common_axis) として返す。content も再導出した軸に合わせて再生成して返す。軸の確定前に「別の cycle で観察したらどう書くか」を自問し、今回の素材に固有の語彙へ張り付いた軸を避ける。タイトル候補は再導出した軸を土台に spawn 時と同じ仕様 (気づき: 抽象度 3 段の 3 案固定 / 洞察: 観点形・事実形 各 1 案以上の 3〜4 案・form 必須) で出し直す。先頭要素を推奨案とする。全候補が機械ゲート (正規表現 、|すると|したら|つつ|（|\( ) にかからないこと。

返り値: { derivation, title_candidates, content }
```
