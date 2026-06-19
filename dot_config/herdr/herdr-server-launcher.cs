// herdr server を console window を一切作らずに起動する wrapper。
// csc.exe /target:winexe でビルドすると、起動した瞬間から GUI subsystem として
// 動くため console window を持たず、子プロセス（herdr.exe）も CreateNoWindow で
// 起動するので OS から見ても完全に window-less。
// VBScript wrapper は Windows 11 25H2 Insider Preview で deprecation 警告ダイアログが
// 出るようになったため C# 製に切替。
using System;
using System.Diagnostics;

class Program
{
    static void Main()
    {
        var exe = Environment.ExpandEnvironmentVariables(
            @"%LOCALAPPDATA%\Programs\Herdr\bin\herdr.exe");
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            Arguments = "server",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        Process.Start(psi);
    }
}
