#Requires AutoHotkey v2.0
#SingleInstance Force

IsKomorebiRunning() {
  ErrorLevel := ProcessExist("komorebi.exe")
  pid := ErrorLevel
  Return pid > 0
}

SendKomorebi(key, action) {
  if IsKomorebiRunning() {
    Run("komorebic.exe " . %action%, , "Hide")
  } else {
    Send(%key%)
  }
  return
}

!f:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe toggle-float", , "Hide")
  } else {
    Send("!f")
  }
  return
}

!x:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe toggle-monocle", , "Hide")
  } else {
    Send("!x")
  }
  return
}

!Left:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus left", , "Hide")
  } else {
    Send("!Left")
  }
  return
}

!Down:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus down", , "Hide")
  } else {
    Send("!Down")
  }
  return
}

!Up:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus up", , "Hide")
  } else {
    Send("!Up")
  }
  return
}

!Right:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus right", , "Hide")
  } else {
    Send("!Right")
  }
  return
}

#Left:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move left", , "Hide")
  } else {
    Send("#Left")
  }
  return
}

#Down:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move down", , "Hide")
  } else {
    Send("#Down")
  }
  return
}

#Up:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move up", , "Hide")
  } else {
    Send("#Up")
  }
  return
}

#Right:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move right", , "Hide")
  } else {
    Send("#Right")
  }
  return
}

!1:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus-workspace 0", , "Hide")
  } else {
    Send("!1")
  }
  return
}

!2:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus-workspace 1", , "Hide")
  } else {
    Send("!2")
  }
  return
}

!3:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus-workspace 2", , "Hide")
  } else {
    Send("!3")
  }
  return
}

!4:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus-workspace 3", , "Hide")
  } else {
    Send("!4")
  }
  return
}

!5:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe focus-workspace 4", , "Hide")
  } else {
    Send("!5")
  }
  return
}

!+1:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move-to-workspace 0", , "Hide")
  } else {
    Send("!+1")
  }
}

!+2:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move-to-workspace 1", , "Hide")
  } else {
    Send("!+2")
  }
}

!+3:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move-to-workspace 2", , "Hide")
  } else {
    Send("!+3")
  }
}

!+4:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move-to-workspace 3", , "Hide")
  } else {
    Send("!+4")
  }
}

!+5:: {
  if IsKomorebiRunning() {
    Run("komorebic.exe move-to-workspace 4", , "Hide")
  } else {
    Send("!+5")
  }
}
