using System;
using System.Diagnostics;
using System.IO;

class Launcher {
    static void Main() {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string clientExe = Path.Combine(baseDir, "client", "Discord.exe");
        if (!File.Exists(clientExe)) {
            clientExe = Path.Combine(baseDir, "Discord.exe");
        }
        if (!File.Exists(clientExe)) return;

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = clientExe;
        psi.WorkingDirectory = Path.GetDirectoryName(clientExe);
        psi.UseShellExecute = false;

        psi.EnvironmentVariables["RAFA_DISCORD_MOD_ROOT"] = baseDir;
        psi.EnvironmentVariables["DISCORD_USER_DATA_DIR"] = Path.Combine(baseDir, "profile");
        psi.EnvironmentVariables["APPDATA"] = Path.Combine(baseDir, "profile", "roaming");
        psi.EnvironmentVariables["LOCALAPPDATA"] = Path.Combine(baseDir, "profile", "local");
        psi.EnvironmentVariables["TEMP"] = Path.Combine(baseDir, "runtime", "temp");
        psi.EnvironmentVariables["TMP"] = psi.EnvironmentVariables["TEMP"];

        Directory.CreateDirectory(Path.Combine(baseDir, "profile", "roaming"));
        Directory.CreateDirectory(Path.Combine(baseDir, "profile", "local"));
        Directory.CreateDirectory(Path.Combine(baseDir, "runtime", "temp"));

        Process.Start(psi);
    }
}
