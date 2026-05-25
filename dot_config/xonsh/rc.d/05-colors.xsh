# シンタックスハイライトをターミナル (WezTerm) の ANSI パレットに従わせる。
# prompt-toolkit の ANSI 色名 (ansiblue 等) はパレットにマップされるので、
# WezTerm の color_scheme (Tender) を変えれば全シェルが一斉に追従する。
# 注意: xonsh の色名 (GREEN / INTENSE_*) は LS_COLORS 用で、ここでは invalid。
#       値には必ず prompt-toolkit の ansiX 名を使う。hex (#rrggbb) は固定色で
#       パレットに追従しないため使わない。
$XONSH_STYLE_OVERRIDES = {
    'Token.Keyword': 'ansiblue',
    'Token.Name.Builtin': 'ansibrightcyan',
    'Token.Literal.String': 'ansigreen',
    'Token.Literal.Number': 'ansiyellow',
    'Token.Comment': 'ansibrightblack',
    'Token.Operator': 'ansicyan',
}
