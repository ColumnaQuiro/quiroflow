-- What two bathroom scales read, one under each foot, when the clinic weighs
-- the patient alongside the posture photos. Optional: without them "Dónde
-- cae el peso" estimates left-right from the points (utils/posture.ts
-- postureBalance); with them the split is measured, and the photo is left
-- to say only how far forward the weight sits, which scales cannot.
--
-- Both or neither: one foot alone says nothing about the split.

alter table public.posture_assessments
  add column if not exists scale_left_kg numeric(5,1),
  add column if not exists scale_right_kg numeric(5,1);

alter table public.posture_assessments
  add constraint posture_assessments_scale_kg_check check (
    (scale_left_kg is null and scale_right_kg is null)
    or (scale_left_kg between 0 and 300 and scale_right_kg between 0 and 300 and scale_left_kg + scale_right_kg > 0)
  );
