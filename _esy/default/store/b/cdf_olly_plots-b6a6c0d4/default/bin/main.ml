open Minttea
open Leaves

let init _ = Command.Noop

type model = {
  gray_bar : Progress.t;
}

let initial_model =
  let width = 50 in
  {
    gray_bar = Progress.make ~width ~color:(`Plain (Spices.color "#3f22a3")) ();
  }

let update event m =
  match event with
  | Event.KeyDown (Key "q" | Escape) -> (m, Command.Quit)
  | Event.Frame _now ->
      let gray_bar = Progress.increment m.gray_bar 0.01 in
      ({ gray_bar }, Command.Noop)
  | _ -> (m, Command.Noop)

let view m =
  Format.sprintf "\n\n%s\n\n" (Progress.view m.gray_bar)

let () = Minttea.app ~init ~update ~view () |> Minttea.start ~initial_model