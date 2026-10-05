# herdr の custom command（prefix+a）から呼ぶ。新しいタブを作り、そのシェルを claude に置き換える。
# herdr にはタブごとに起動するものを選ぶプロファイルが無いので、タブのシェルに exec claude を打ち込む。
# claude を終えるとペインも閉じる。
# command の文字列に ' を含めると herdr から起動されないので、処理はこのファイルに置く。
# herdr の実行ファイルは、GUI から起動された herdr の PATH に無いことがあるので引数で受け取る。
def main [herdr: string] {
    let pane = ^$herdr tab create --focus | from json | get result.root_pane.pane_id
    ^$herdr pane run $pane exec claude
}
