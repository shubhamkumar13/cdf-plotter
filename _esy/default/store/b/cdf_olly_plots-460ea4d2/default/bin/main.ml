open Minttea

type model = {
  grid_size: int;
  cell_width: int;
  cell_height: int;
}

let initial_model = {
  grid_size = 64;
  cell_width = 3;
  cell_height = 3;
}

let init model = Command.Noop

let update model = function
  | _ -> model, Command.Noop

let draw_horizontal_line cell_width

items