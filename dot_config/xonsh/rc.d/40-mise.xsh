# mise (ランタイム版管理)
# mise の xonsh 出力は Windows パスをバックスラッシュ生で埋め込むため、
# Python 文字列リテラルとして不正になる (\U 等で SyntaxError)。スラッシュに
# 置換して回避 (mise.exe は / 区切りパスでも起動可)。mise 修正後は不要。
execx($(mise activate xonsh).replace(chr(92), '/'))
