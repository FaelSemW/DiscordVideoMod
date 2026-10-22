using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace DiscordInstaller {
    public class InstallerForm : Form {
        private Label lblTitle;
        private Label lblStatus;
        private ProgressBar progressBar;
        private BackgroundWorker worker;

        public InstallerForm() {
            this.Text = "Discord Mod Setup";
            this.Size = new Size(520, 260);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(43, 45, 49);
            this.ForeColor = Color.White;

            try {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico")) {
                    if (s != null) this.Icon = new Icon(s);
                }
            } catch {}

            lblTitle = new Label();
            lblTitle.Text = "Instalador do Discord Mod";
            lblTitle.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            lblTitle.Location = new Point(30, 30);
            lblTitle.AutoSize = true;
            lblTitle.ForeColor = Color.FromArgb(242, 243, 245);
            this.Controls.Add(lblTitle);

            lblStatus = new Label();
            lblStatus.Text = "Iniciando instalacao...";
            lblStatus.Font = new Font("Segoe UI", 10, FontStyle.Regular);
            lblStatus.Location = new Point(32, 85);
            lblStatus.Size = new Size(450, 30);
            lblStatus.ForeColor = Color.FromArgb(181, 186, 193);
            this.Controls.Add(lblStatus);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(32, 130);
            progressBar.Size = new Size(440, 24);
            progressBar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(progressBar);

            worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;
            worker.DoWork += Worker_DoWork;
            worker.ProgressChanged += Worker_ProgressChanged;
            worker.RunWorkerCompleted += Worker_RunWorkerCompleted;

            this.Load += (s, e) => worker.RunWorkerAsync();
        }

        private void Worker_ProgressChanged(object sender, ProgressChangedEventArgs e) {
            progressBar.Value = Math.Min(100, Math.Max(0, e.ProgressPercentage));
            if (e.UserState != null) {
                lblStatus.Text = e.UserState.ToString();
            }
        }

        private void Worker_DoWork(object sender, DoWorkEventArgs e) {
            try {
                worker.ReportProgress(10, "Fechando processos do Discord em execucao...");
                foreach (var p in Process.GetProcessesByName("Discord")) {
                    try { p.Kill(); p.WaitForExit(2000); } catch {}
                }
                Thread.Sleep(500);

                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string targetDir = Path.Combine(localAppData, "DiscordMod");

                worker.ReportProgress(25, "Preparando pasta de destino...");
                if (!Directory.Exists(targetDir)) {
                    Directory.CreateDirectory(targetDir);
                }

                worker.ReportProgress(40, "Extraindo arquivos do Discord Mod...");
                Assembly asm = Assembly.GetExecutingAssembly();
                string resourceName = null;
                foreach (var name in asm.GetManifestResourceNames()) {
                    if (name.EndsWith("payload.zip", StringComparison.OrdinalIgnoreCase)) {
                        resourceName = name;
                        break;
                    }
                }

                if (resourceName != null) {
                    string tempZip = Path.Combine(Path.GetTempPath(), "discord_mod_payload_" + Guid.NewGuid().ToString("N") + ".zip");
                    using (Stream resStream = asm.GetManifestResourceStream(resourceName))
                    using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write)) {
                        resStream.CopyTo(fs);
                    }

                    worker.ReportProgress(60, "Instalando componentes e configuracoes...");
                    using (ZipArchive archive = ZipFile.OpenRead(tempZip)) {
                        int total = archive.Entries.Count;
                        int count = 0;
                        foreach (var entry in archive.Entries) {
                            string destPath = Path.Combine(targetDir, entry.FullName);
                            if (string.IsNullOrEmpty(entry.Name)) {
                                Directory.CreateDirectory(destPath);
                            } else {
                                Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                                entry.ExtractToFile(destPath, true);
                            }
                            count++;
                            if (count % 50 == 0) {
                                int pct = 60 + (int)((count / (float)total) * 25);
                                worker.ReportProgress(pct, "Instalando: " + entry.Name);
                            }
                        }
                    }

                    try { File.Delete(tempZip); } catch {}
                }

                worker.ReportProgress(90, "Criando atalhos na Area de Trabalho e Menu Iniciar...");
                string launcherExe = Path.Combine(targetDir, "Discord.exe");
                string clientExe = Path.Combine(targetDir, "client", "Discord.exe");
                string icoPath = Path.Combine(targetDir, "client", "app.ico");

                if (!File.Exists(launcherExe) && File.Exists(clientExe)) {
                    launcherExe = clientExe;
                }

                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");

                CreateShortcut(Path.Combine(desktop, "Discord.lnk"), launcherExe, targetDir, icoPath, "Discord");
                CreateShortcut(Path.Combine(startMenu, "Discord.lnk"), launcherExe, targetDir, icoPath, "Discord");

                worker.ReportProgress(100, "Concluido! Iniciando o Discord...");
                Thread.Sleep(800);

                if (File.Exists(launcherExe)) {
                    Process.Start(new ProcessStartInfo {
                        FileName = launcherExe,
                        WorkingDirectory = targetDir
                    });
                }
            } catch (Exception ex) {
                MessageBox.Show("Erro durante a instalacao: " + ex.Message, "Falha na Instalacao", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void Worker_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e) {
            this.Close();
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string iconPath, string description) {
            try {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null) {
                    dynamic shell = Activator.CreateInstance(shellType);
                    dynamic shortcut = shell.CreateShortcut(shortcutPath);
                    shortcut.TargetPath = targetPath;
                    shortcut.WorkingDirectory = workingDir;
                    if (File.Exists(iconPath)) {
                        shortcut.IconLocation = iconPath + ",0";
                    }
                    shortcut.Description = description;
                    shortcut.Save();
                }
            } catch {}
        }

        [STAThread]
        public static void Main() {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}
