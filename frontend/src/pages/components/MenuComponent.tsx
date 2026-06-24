import React from 'react'
import maatMiniLogo from '../../images/MAAT-Mini.png'
import '../../styling/MenuComponent.scss'

interface MenuComponentProps {
  showUpload?: boolean
  showDatasetUpload?: boolean
  showHelp?: boolean
  showCreate?: boolean
  showReviewButton?: boolean
  showLast?: boolean
}

export default function MenuComponent(_props: MenuComponentProps) {
  return (
    <nav className="menu menu--top menu--inverted menu--borderless menu--huge" aria-label="MAAT-Mini">
      <div className="menu__container menu__container--logo-only">
        <div className="menu__item menu__item--header menu__item--static" aria-label="MAAT-Mini Prolific study">
          <img src={maatMiniLogo} alt="MAAT-Mini" className="menu__logo" />
        </div>
      </div>
    </nav>
  )
}
