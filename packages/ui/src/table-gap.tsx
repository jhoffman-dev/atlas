/** Room for the rows a virtualised table leaves out of the page, so its scrollbar stays true. */
export function TableGap({ height, width }: { height: number; width: number }) {
  return (
    <tr aria-hidden="true" className="table__spacer">
      <td colSpan={width} style={{ height }} />
    </tr>
  );
}
