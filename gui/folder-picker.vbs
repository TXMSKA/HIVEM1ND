' Opens the system folder dialog and writes the chosen folder to a Unicode file, because a console would turn
' accented folder names into the wrong code page. Arguments: the dialog title and the output file.
Option Explicit
Dim shell, folder, fso, file
Set shell = CreateObject("Shell.Application")
' 0x41: only file system folders, and the resizable dialog with a New Folder button.
Set folder = shell.BrowseForFolder(0, WScript.Arguments(0), &H41, "")
If folder Is Nothing Then WScript.Quit 1
Set fso = CreateObject("Scripting.FileSystemObject")
Set file = fso.CreateTextFile(WScript.Arguments(1), True, True)
file.Write folder.Self.Path
file.Close
