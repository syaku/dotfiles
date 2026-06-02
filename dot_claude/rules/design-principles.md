---
paths: ["**/*.{ts,tsx,js,jsx,mjs,cjs,py,rs,go,rb,java,kt,swift,c,h,cpp,cc,hpp,cs,php,scala,ex,exs,lua,dart,vue,svelte,sh,bash,zsh,fish}"]
---

# 設計原則

- **過度な抽象化・将来の拡張を見越した設計は避ける（YAGNI）。** 「いつか使うかも」のための interface・generics・コンフィグ化・hook 化は、その「いつか」が来てから入れる。3 つの似たコードを書いてから共通化する方が早道。
- **DRY は手段、目的化しない。** 重複の除去より「意図の重複」の除去を優先する。たまたま同形でも意味が違うコードは別々に保つ方が、無理に共通化して後で剥がす羽目になるより安い。Rule of Three（3 回目で初めて共通化）が目安。
- **識別子で How を語る。** 関数名・変数名で「何をする・何である」が読めるようにし、コメントなしで概要が掴める命名を選ぶ（`coding-style.md` の「コードコメントは Why not だけ」と呼応する）。短さより伝わりやすさを優先する（`getUserById` > `getUsr`）。略語は業界標準のもの（API, URL, ID 等）に絞る。
