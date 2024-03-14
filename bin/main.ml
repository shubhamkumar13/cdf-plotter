open Minttea

[@@@ warning "-32"]
[@@@ warning "-34"]
[@@@ warning "-69"]
[@@@ warning "-27"]
[@@@ warning "-26"]

let ref = Riot.Ref.make ()
let init _ = Command.Seq [ Enter_alt_screen ]

type point = {
  x : int;
  y : int;
  value : string;
}

type grid = {
  addr : point array array;
}

let mk_point x y value = { x; y; value}
let mk_grid ~height ~width ch = Array.make_matrix height width ch

let string_to_fmt s = Fmt.of_to_string (fun _ -> s)

let hex_to_string hex =
  let hex = Uchar.of_int hex in
  let buffer = Buffer.create 5 in
  Uutf.Buffer.add_utf_8 buffer hex;
  Buffer.contents buffer

let initial_model = 
  let grid = mk_grid ~height:46 ~width:200 "" in
  let x_axis ~hex ~y_coord grid =
    let height = Array.length grid in
    let width = Array.length grid.(0) in
    let temp_line = Array.make width (hex_to_string hex) in
    grid.(height - 1) <- temp_line;
    let x_axis_arrow = hex_to_string 0x25BA in
    grid.(height - 1).(width - 1) <- x_axis_arrow
  in
  let y_axis ~hex ~x_coord grid =
    let height = Array.length grid in
    let width = Array.length grid.(0) in
    let f arr = arr.(x_coord) <- hex_to_string hex in
    Array.iter f grid;
    grid.(0).(x_coord) <- hex_to_string 0x25B2;
    grid.(height - 1).(x_coord) <- hex_to_string 0x2579
  in
  x_axis ~hex:0x2501 ~y_coord:0 grid;
  y_axis ~hex:0x2503 ~x_coord:0 grid;
  grid

let update event model =
  match event with
  | _ -> (model, Command.Noop)

let dark_gray = Spices.color "#767676"
let bold fmt = Spices.(default |> bold true |> build) fmt

let time fmt =
  Spices.(default |> italic true |> fg dark_gray |> max_width 22 |> build) fmt

let view model =
  (* should be a grid of x and y axis *)
  let rows = 
    let sep = string_to_fmt "" in
    Fmt.array ~sep Fmt.string 
  in
  let sep = string_to_fmt "\n" in
  (* Fmt.pr "%a\n" (Fmt.Dump.array (Fmt.Dump.array Fmt.char)) model; *)
  Fmt.str "%a" (Fmt.array ~sep rows) model

let () = Minttea.app ~init ~update ~view () |> Minttea.start ~initial_model